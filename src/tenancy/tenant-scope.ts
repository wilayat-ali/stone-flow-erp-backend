// Every query on company data must include the company from the token.
//
//   find({ where: { ...filters, ...inCompany(tenant.companyId) } })
//
// For writes, set `company: { id: tenant.companyId }` from the tenant context
// and ignore any company id in the request. Updates and deletes must filter on
// both the row id and the company, so an id from another company matches
// nothing:
//
//   update({ id, ...inCompany(tenant.companyId) }, changes)
export function inCompany(companyId: string): { company: { id: string } } {
  return { company: { id: companyId } };
}
