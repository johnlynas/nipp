-- Add B-tree index on Role.name for prefix search (search-autocomplete)
CREATE INDEX "Role_name_orgId_index" ON "Role"("name", "organizationId");
