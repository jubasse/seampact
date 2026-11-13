//! CHK-109 at the expansion level: nodes of generated trees moved into `$include` files give the
//! same tree and key order as the inline form; only the source positions differ.

use crate::harness::{Options, expand_with};
use seampact_json::JsonValue;

const NAMES: [&str; 10] = [
    "alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa",
];
const SEEDS: u32 = 300;
const MOVED_FILES_AT_LEAST: usize = 100;

/// The mulberry32 generator of the TypeScript test, so a seed means the same tree.
struct Random(u32);

impl Random {
    fn next(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x6d2b_79f5);

        let mut t = self.0;

        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 0x3d));

        f64::from(t ^ (t >> 14)) / 4_294_967_296.0
    }

    /// `Math.floor(next() * limit)`.
    #[expect(
        clippy::cast_precision_loss,
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "limits are small and the product is below the limit"
    )]
    fn below(&mut self, limit: usize) -> usize {
        (self.next() * limit as f64).floor() as usize
    }
}

#[derive(Clone)]
enum Tree {
    Map(Vec<(String, Tree)>),
    Number(usize),
    Text(String),
    Flag(bool),
    Pair(usize, usize),
}

fn generated_tree(random: &mut Random, depth: usize) -> Vec<(String, Tree)> {
    let count = 1 + random.below(5);
    let mut keys: Vec<&str> = NAMES.to_vec();

    // The TypeScript shuffles with a comparator that draws; any permutation serves the property.
    for index in (1..keys.len()).rev() {
        keys.swap(index, random.below(index + 1));
    }

    keys.into_iter()
        .take(count)
        .map(|key| {
            let pick = random.next();
            let value = if depth > 0 && pick < 0.45 {
                Tree::Map(generated_tree(random, depth - 1))
            } else if pick < 0.65 {
                Tree::Number(random.below(1000))
            } else if pick < 0.8 {
                Tree::Text(format!("text {}", random.below(100)))
            } else if pick < 0.9 {
                Tree::Flag(random.next() < 0.5)
            } else {
                Tree::Pair(random.below(9), random.below(9))
            };

            (key.to_owned(), value)
        })
        .collect()
}

fn scalar_text(value: &Tree) -> String {
    match value {
        Tree::Number(number) => number.to_string(),
        Tree::Text(text) => format!("{text:?}"),
        Tree::Flag(flag) => flag.to_string(),
        Tree::Pair(first, second) => format!("[{first},{second}]"),
        Tree::Map(_) => String::new(),
    }
}

fn json_of(entries: &[(String, Tree)]) -> String {
    let members: Vec<String> = entries
        .iter()
        .map(|(key, value)| match value {
            Tree::Map(inner) => format!("{key:?}:{}", json_of(inner)),
            other => format!("{key:?}:{}", scalar_text(other)),
        })
        .collect();

    format!("{{{}}}", members.join(","))
}

struct Emitter {
    files: Vec<(String, String)>,
    includes: usize,
    counter: usize,
    external: bool,
}

impl Emitter {
    /// The lines of one mapping. With `external`, a contiguous slice of its entries (sometimes
    /// all of them) moves to its own file, and `$include` stands where the slice began.
    fn entries(
        &mut self,
        map: &[(String, Tree)],
        indent: usize,
        directory: &str,
        random: &mut Random,
    ) -> Vec<String> {
        let mut lines = Vec::new();
        let mut slice: Option<(usize, usize)> = None;

        if self.external && random.next() < 0.5 {
            let start = random.below(map.len());

            slice = Some((start, start + 1 + random.below(map.len() - start)));
        }

        let pad = " ".repeat(indent);

        for (index, (key, value)) in map.iter().enumerate() {
            if let Some((start, end)) = slice
                && index >= start
                && index < end
            {
                if index == start {
                    lines.push(self.moved_slice(map, (start, end), &pad, directory, random));
                }

                continue;
            }

            match value {
                Tree::Map(inner) => {
                    lines.push(format!("{pad}{key}:"));
                    lines.extend(self.entries(inner, indent + 2, directory, random));
                }
                other => lines.push(format!("{pad}{key}: {}", scalar_text(other))),
            }
        }

        lines
    }

    fn moved_slice(
        &mut self,
        map: &[(String, Tree)],
        (start, end): (usize, usize),
        pad: &str,
        directory: &str,
        random: &mut Random,
    ) -> String {
        let name = format!("part{}.yaml", self.counter);
        let moved: Vec<(String, Tree)> = map[start..end].to_vec();

        self.counter += 1;
        self.includes += 1;

        // A file reached by a pointer holds its mapping under a name: the other way to include.
        let via_pointer = random.next() < 0.3;
        let prefix = if directory == "." { "./parts/" } else { "./" };

        if via_pointer {
            let body = self.entries(&moved, 2, "parts", random).join("\n");

            self.files.push((
                format!("parts/{name}"),
                format!("Fragment:\n{body}\nOther: {{ x: 1 }}\n"),
            ));

            return format!("{pad}$include: {prefix}{name}#/Fragment");
        }

        let body = self.entries(&moved, 0, "parts", random).join("\n");

        self.files
            .push((format!("parts/{name}"), format!("{body}\n")));

        format!("{pad}$include: {prefix}{name}")
    }
}

fn emitted(tree: &[(String, Tree)], seed: u32, external: bool) -> (Vec<(String, String)>, usize) {
    let mut emitter = Emitter {
        files: Vec::new(),
        includes: 0,
        counter: 0,
        external,
    };
    let mut random = Random(seed + 1000);
    let body = emitter.entries(tree, 4, ".", &mut random).join("\n");

    emitter.files.push((
        "api.yaml".to_owned(),
        format!("api: {{ name: t }}\nschemas:\n  S:\n{body}\n"),
    ));

    (emitter.files, emitter.includes)
}

#[test]
fn inline_equals_included() {
    let mut moved = 0;

    for seed in 1..=SEEDS {
        let tree = generated_tree(&mut Random(seed), 3);
        let (inline_files, _) = emitted(&tree, seed, false);
        let (split_files, includes) = emitted(&tree, seed, true);

        moved += includes;

        let inline = expand_with(inline_files, &Options::default());
        let split = expand_with(split_files, &Options::default());

        assert!(
            inline.rules().is_empty(),
            "seed {seed} inline: {}",
            inline.printed
        );
        assert!(
            split.rules().is_empty(),
            "seed {seed} split: {}",
            split.printed
        );
        // Same tree and same key order: the text keeps the order.
        assert_eq!(split.tree_text(), inline.tree_text(), "seed {seed}");

        let schemas = match inline.build.tree.get("schemas") {
            Some(JsonValue::Object(schemas)) => schemas,
            other => panic!("seed {seed}: no schemas: {other:?}"),
        };
        let expected = format!(r#"{{"S":{}}}"#, json_of(&tree));

        assert_eq!(
            serde_json::to_string(&JsonValue::Object(schemas.clone())).unwrap(),
            expected,
            "seed {seed}"
        );

        // Only the positions differ.
        if includes > 0 {
            assert_eq!(
                split.build.locs.keys().collect::<Vec<_>>(),
                inline.build.locs.keys().collect::<Vec<_>>(),
                "seed {seed}"
            );
            assert_ne!(split.build.locs, inline.build.locs, "seed {seed}");
        }
    }

    assert!(moved > MOVED_FILES_AT_LEAST, "{moved} files moved");
}
