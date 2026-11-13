//! Events to tree: an explicit stack, so no input depth recurses.

use std::mem;

use saphyr_parser::{
    Event, Marker, Parser, ScalarStyle as ParserStyle, ScanError, Span as ParserSpan,
};
use seampact_diagnostics::InternalError;
use seampact_span::{FileId, Span, TextSize};

use super::char_offsets::CharOffsets;
use super::ranges::{
    Properties, block_header_start, block_scalar_end, quoted_end, scan_properties,
    sequence_indicator_start, skip_blanks, trailing_end,
};
use super::{ScalarStyle, YamlDocument, YamlKind, YamlName, YamlNode, YamlPair, YamlProblem};
use crate::LOAD_MAX_DEPTH;

/// The deepest level kept in the tree: the walk reports a node one level below the limit.
const MAX_KEPT_DEPTH: usize = LOAD_MAX_DEPTH + 1;

const RECURSION_LIMIT_INFO: &str = "recursion limit exceeded";

/// A parser span in byte offsets.
#[derive(Debug, Clone, Copy)]
struct ByteSpan {
    start: usize,
    end: usize,
}

/// A finished node and where its trailing white space and comment end (`range[2]` of the `yaml`
/// package), which is where a block collection ends. `node` is `None` below the kept depth.
struct Built {
    node: Option<YamlNode>,
    end: usize,
}

enum KeySlot {
    /// The next node is a key.
    Waiting,
    /// A key below the kept depth was seen; the next node is its value.
    Skipped,
    /// A key was seen; the next node is its value.
    Held(YamlNode),
}

enum Members {
    Sequence(Vec<YamlNode>),
    Mapping { pairs: Vec<YamlPair>, key: KeySlot },
}

struct Frame {
    members: Members,
    /// Whether the collection itself is in the tree.
    kept: bool,
    /// Whether its children are.
    keeps_children: bool,
    start: usize,
    flow: bool,
    anchor: Option<YamlName>,
    tag: Option<String>,
    /// The end of the last child, for a block collection.
    last_end: usize,
}

pub(super) fn parse_document(file: FileId, text: &str) -> Result<YamlDocument, InternalError> {
    let mut builder = TreeBuilder::new(file, text);
    let mut parser = Parser::new_from_str(text).keep_tags(true);
    let mut documents_started = 0_u32;

    while let Some(next) = parser.next_event() {
        let (event, span) = match next {
            Ok(pair) => pair,
            Err(error) => return builder.refused(&error),
        };
        let bytes = builder.byte_span(span)?;

        match event {
            Event::DocumentStart(_) => {
                documents_started += 1;

                if documents_started > 1 {
                    return builder.second_document(bytes.start);
                }
            }
            Event::StreamEnd => break,
            Event::Scalar(value, style, anchor, tag) => {
                let tag = tag.map(|tag| format!("{}{}", tag.handle, tag.suffix));

                builder.scalar(value.into_owned(), style, anchor, tag, bytes)?;
            }
            Event::Alias(_) => builder.alias(bytes)?,
            Event::SequenceStart(anchor, tag) => {
                let tag = tag.map(|tag| format!("{}{}", tag.handle, tag.suffix));

                builder.open(CollectionKind::Sequence, anchor, tag, bytes);
            }
            Event::MappingStart(anchor, tag) => {
                let tag = tag.map(|tag| format!("{}{}", tag.handle, tag.suffix));

                builder.open(CollectionKind::Mapping, anchor, tag, bytes);
            }
            Event::SequenceEnd | Event::MappingEnd => builder.close(bytes)?,
            Event::Nothing | Event::StreamStart | Event::DocumentEnd => {}
        }
    }

    Ok(YamlDocument {
        root: builder.root,
        problem: None,
    })
}

#[derive(Clone, Copy)]
enum CollectionKind {
    Sequence,
    Mapping,
}

struct TreeBuilder<'text> {
    text: &'text str,
    offsets: CharOffsets<'text>,
    file: FileId,
    stack: Vec<Frame>,
    root: Option<YamlNode>,
}

impl<'text> TreeBuilder<'text> {
    fn new(file: FileId, text: &'text str) -> Self {
        Self {
            text,
            offsets: CharOffsets::new(text),
            file,
            stack: Vec::new(),
            root: None,
        }
    }

    fn byte_of(&self, marker: Marker) -> Result<usize, InternalError> {
        self.offsets.byte_offset(marker.index()).ok_or_else(|| {
            InternalError::new(format!(
                "the YAML parser reported character {} of a text of {} bytes",
                marker.index(),
                self.text.len()
            ))
        })
    }

    fn byte_span(&self, span: ParserSpan) -> Result<ByteSpan, InternalError> {
        Ok(ByteSpan {
            start: self.byte_of(span.start)?,
            end: self.byte_of(span.end)?,
        })
    }

    fn span(&self, start: usize, end: usize) -> Result<Span, InternalError> {
        Ok(Span::new(
            self.file,
            to_text_size(start)?,
            to_text_size(end)?,
        ))
    }

    fn refused(self, error: &ScanError) -> Result<YamlDocument, InternalError> {
        let marker = self.byte_of(*error.marker())?;
        let at = self.span(marker, marker)?;
        let problem = if error.info() == RECURSION_LIMIT_INFO {
            YamlProblem::TooDeep { at }
        } else {
            YamlProblem::Syntax {
                info: error.info().to_owned(),
                at,
            }
        };

        Ok(YamlDocument {
            root: None,
            problem: Some(problem),
        })
    }

    fn second_document(self, start: usize) -> Result<YamlDocument, InternalError> {
        let at = self.span(start, self.text.len())?;

        Ok(YamlDocument {
            root: self.root,
            problem: Some(YamlProblem::SecondDocument { at }),
        })
    }

    /// Whether a node about to be built is kept: the root is, a child is when its parent keeps
    /// children.
    fn is_next_node_kept(&self) -> bool {
        self.stack.last().is_none_or(|parent| parent.keeps_children)
    }

    fn scalar(
        &mut self,
        value: String,
        parser_style: ParserStyle,
        anchor_id: usize,
        tag: Option<String>,
        bytes: ByteSpan,
    ) -> Result<(), InternalError> {
        let style = scalar_style(parser_style);
        let has_properties = anchor_id != 0 || tag.is_some();
        let properties = if has_properties {
            scan_properties(self.text, bytes.start)
        } else {
            Properties {
                anchor: None,
                last_end: bytes.start,
                after: bytes.start,
            }
        };
        let anchor = properties
            .anchor
            .clone()
            .filter(|_| anchor_id != 0)
            .map(YamlName::new);

        if style == ScalarStyle::Plain && value.is_empty() {
            return self.empty_scalar(&properties, has_properties, anchor, tag, bytes);
        }

        let (start, end, node_end) = match style {
            ScalarStyle::Block => {
                let start = if has_properties {
                    properties.after
                } else {
                    block_header_start(self.text, bytes.start)
                };

                let end = block_scalar_end(self.text, start, bytes.end);

                (start, end, end)
            }
            ScalarStyle::Plain | ScalarStyle::Quoted => {
                let start = properties.after.min(bytes.end);
                let end = if style == ScalarStyle::Quoted {
                    quoted_end(self.text, start).unwrap_or(bytes.end)
                } else {
                    bytes.end
                };

                (start, end, trailing_end(self.text, end))
            }
        };
        let node = self.node(start, end, anchor, tag, YamlKind::Scalar { value, style })?;

        self.attach(Built {
            node,
            end: node_end,
        });

        Ok(())
    }

    /// An empty plain scalar: an empty value after `:` or `-` (or after properties), an empty key,
    /// or the value a mapping does not have (`{a, b}`, `? k`).
    fn empty_scalar(
        &mut self,
        properties: &Properties,
        has_properties: bool,
        anchor: Option<YamlName>,
        tag: Option<String>,
        bytes: ByteSpan,
    ) -> Result<(), InternalError> {
        let in_value_position = self.stack.last().is_some_and(|frame| {
            matches!(
                frame.members,
                Members::Mapping {
                    key: KeySlot::Skipped | KeySlot::Held(_),
                    ..
                }
            )
        });
        let colon_at_start = self.text.as_bytes().get(bytes.start) == Some(&b':');

        if in_value_position && !has_properties && !colon_at_start {
            self.attach_absent_value();

            return Ok(());
        }

        let introducer_end = if has_properties {
            properties.last_end
        } else if in_value_position {
            bytes.start + 1
        } else {
            bytes.start
        };
        let position = skip_blanks(self.text, introducer_end);
        let comment_follows =
            position > introducer_end && self.text.as_bytes().get(position) == Some(&b'#');
        let node_end = if comment_follows {
            trailing_end(self.text, introducer_end)
        } else {
            position
        };
        let kind = YamlKind::Scalar {
            value: String::new(),
            style: ScalarStyle::Plain,
        };
        let node = self.node(position, position, anchor, tag, kind)?;

        self.attach(Built {
            node,
            end: node_end,
        });

        Ok(())
    }

    fn alias(&mut self, bytes: ByteSpan) -> Result<(), InternalError> {
        let Some(name) = self.text.get(bytes.start + 1..bytes.end) else {
            return Err(InternalError::new(
                "the YAML parser gave an alias a span that is not on character boundaries",
            ));
        };
        let kind = YamlKind::Alias(YamlName::new(name.to_owned()));
        let node = self.node(bytes.start, bytes.end, None, None, kind)?;

        self.attach(Built {
            node,
            end: trailing_end(self.text, bytes.end),
        });

        Ok(())
    }

    /// A node in the tree when it is kept.
    fn node(
        &self,
        start: usize,
        end: usize,
        anchor: Option<YamlName>,
        tag: Option<String>,
        kind: YamlKind,
    ) -> Result<Option<YamlNode>, InternalError> {
        if !self.is_next_node_kept() {
            return Ok(None);
        }

        Ok(Some(YamlNode {
            span: self.span(start, end)?,
            anchor,
            tag,
            kind,
        }))
    }

    fn open(
        &mut self,
        kind: CollectionKind,
        anchor_id: usize,
        tag: Option<String>,
        bytes: ByteSpan,
    ) {
        let properties = scan_properties(self.text, bytes.start);
        let start = properties.after;
        let opens_flow =
            matches!(self.text.as_bytes().get(start), Some(b'[' | b'{')) && bytes.end > start;
        let start = match kind {
            CollectionKind::Sequence if !opens_flow => sequence_indicator_start(self.text, start),
            _ => start,
        };
        let kept = self.is_next_node_kept();
        let depth = self.stack.len();
        let anchor = properties
            .anchor
            .filter(|_| anchor_id != 0)
            .map(YamlName::new);
        let members = match kind {
            CollectionKind::Sequence => Members::Sequence(Vec::new()),
            CollectionKind::Mapping => Members::Mapping {
                pairs: Vec::new(),
                key: KeySlot::Waiting,
            },
        };

        self.stack.push(Frame {
            members,
            kept,
            keeps_children: kept && depth < MAX_KEPT_DEPTH,
            start,
            flow: opens_flow,
            anchor,
            tag,
            last_end: start,
        });
    }

    fn close(&mut self, bytes: ByteSpan) -> Result<(), InternalError> {
        let Some(frame) = self.stack.pop() else {
            return Err(InternalError::new(
                "the YAML parser closed a collection it had not opened",
            ));
        };
        let end = if frame.flow {
            bytes.end
        } else {
            frame.last_end
        };
        let node_end = if frame.flow {
            trailing_end(self.text, end)
        } else {
            end
        };
        let node = if frame.kept {
            let kind = match frame.members {
                Members::Sequence(items) => YamlKind::Sequence(items),
                Members::Mapping { pairs, .. } => YamlKind::Mapping(pairs),
            };

            Some(YamlNode {
                span: self.span(frame.start, end)?,
                anchor: frame.anchor,
                tag: frame.tag,
                kind,
            })
        } else {
            None
        };

        self.attach(Built {
            node,
            end: node_end,
        });

        Ok(())
    }

    /// Gives a finished node to the collection being built, or makes it the root.
    fn attach(&mut self, built: Built) {
        let Some(frame) = self.stack.last_mut() else {
            if self.root.is_none() {
                self.root = built.node;
            }

            return;
        };

        frame.last_end = built.end;

        match &mut frame.members {
            Members::Sequence(items) => items.extend(built.node),
            Members::Mapping { pairs, key } => {
                *key = match mem::replace(key, KeySlot::Waiting) {
                    KeySlot::Waiting => match built.node {
                        Some(node) => KeySlot::Held(node),
                        None => KeySlot::Skipped,
                    },
                    KeySlot::Held(held) => {
                        pairs.extend(built.node.map(|value| YamlPair {
                            key: held,
                            value: Some(value),
                        }));

                        KeySlot::Waiting
                    }
                    KeySlot::Skipped => KeySlot::Waiting,
                };
            }
        }
    }

    /// The pending key has no value: it is a pair with `value` `None`.
    fn attach_absent_value(&mut self) {
        let Some(Frame {
            members: Members::Mapping { pairs, key },
            ..
        }) = self.stack.last_mut()
        else {
            return;
        };

        if let KeySlot::Held(held) = mem::replace(key, KeySlot::Waiting) {
            pairs.push(YamlPair {
                key: held,
                value: None,
            });
        }
    }
}

fn scalar_style(style: ParserStyle) -> ScalarStyle {
    match style {
        ParserStyle::Plain => ScalarStyle::Plain,
        ParserStyle::SingleQuoted | ParserStyle::DoubleQuoted => ScalarStyle::Quoted,
        ParserStyle::Literal | ParserStyle::Folded => ScalarStyle::Block,
    }
}

fn to_text_size(offset: usize) -> Result<TextSize, InternalError> {
    u32::try_from(offset).map(TextSize::from).map_err(|_| {
        InternalError::new(format!(
            "the offset {offset} does not fit a span of a loaded file"
        ))
    })
}
