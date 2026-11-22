//! The catalogues whose names the editor schemas list.

/// A catalogue whose declared names an editor schema lists.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum EditorCatalogue {
    /// The `identities` catalogue.
    Identities,
    /// The `rights` catalogue.
    Rights,
    /// The `requirements` catalogue.
    Requirements,
    /// The `enums` catalogue.
    Enums,
    /// The `errors` catalogue.
    Errors,
    /// The `pagings` catalogue.
    Pagings,
    /// The `schemas` catalogue.
    Schemas,
}

impl EditorCatalogue {
    /// The catalogue a declaration's `catalogue` member names, or `None` when the editor schemas
    /// list no names of it.
    #[must_use]
    pub fn from_name(name: &str) -> Option<Self> {
        match name {
            "identities" => Some(Self::Identities),
            "rights" => Some(Self::Rights),
            "requirements" => Some(Self::Requirements),
            "enums" => Some(Self::Enums),
            "errors" => Some(Self::Errors),
            "pagings" => Some(Self::Pagings),
            "schemas" => Some(Self::Schemas),
            _ => None,
        }
    }
}

impl EditorCatalogue {
    /// The catalogue's name, as a declaration's `catalogue` member writes it.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Identities => "identities",
            Self::Rights => "rights",
            Self::Requirements => "requirements",
            Self::Enums => "enums",
            Self::Errors => "errors",
            Self::Pagings => "pagings",
            Self::Schemas => "schemas",
        }
    }
}
