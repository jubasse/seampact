//! The route's `filteredBy` right.

use seampact_pipeline::PassError;

use crate::catalogues::AccessRightsCatalogues;
use crate::not_ported::not_ported_yet;
use crate::report::AccessRightsReporter;
use crate::routes::AccessRightsRoute;
use crate::schema_use::AccessRightsContext;

pub(crate) fn access_rights_filtered_by(
    _context: &AccessRightsContext,
    _reporter: &mut AccessRightsReporter,
    _catalogues: &AccessRightsCatalogues,
    _route: &AccessRightsRoute,
) -> Result<Option<String>, PassError> {
    Err(not_ported_yet("accessRightsFilteredBy"))
}
