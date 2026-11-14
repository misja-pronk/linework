# Azure Databricks facts brief (as of 2026-11-14)

Audience: consultant who designs and draws large Azure Databricks platforms. Feeds the diagram vocabulary and the reference model.
Sources are Microsoft Learn (`learn.microsoft.com/azure/databricks/...`) pages read on 2026-11-14. "(unverified)" means not confirmed on an official page.

Short URL prefix used below: `L/` = `https://learn.microsoft.com/en-us/azure/databricks/`

---

## 1. Product names now (and former names)

Big picture: in 2026 several products were renamed. Use the new names on diagrams; put the old name in small text only where customers still use it.

| Current name (use this) | Former name(s) | Since | Notes |
|---|---|---|---|
| **Lakeflow Connect** | (none) | 2024-25 | Managed ingestion. Connector types: SaaS, database (CDC), file source, query-based, streaming, community, custom. |
| **Lakeflow pipelines** / **Spark Declarative Pipelines on Lakeflow** | DLT, Delta Live Tables, Lakeflow Declarative Pipelines, Lakeflow Spark Declarative Pipelines | Jun 2025, Nov 2025 | The docs page title is "Spark Declarative Pipelines on Lakeflow"; body text says "Lakeflow pipelines". Built on open-source Apache Spark Declarative Pipelines. Needs Premium. |
| **Lakeflow Jobs** | Databricks Jobs, Workflows | Jun 2025 | System schema is `lakeflow`. |
| **Lakeflow Designer** | (new) | Preview Apr 2026, GA 16 Jun 2026 | Visual no-code canvas for data prep, backed by generated code and governed by Unity Catalog. |
| **Auto Loader** | (unchanged) | | Incremental file ingestion from cloud storage. "File events" on external locations is the recommended mode (GA Dec 2025). |
| **Unity Catalog** | (unchanged) | | Includes **Unity Gateway** (AI governance, GA 4 Aug 2026). In Apr 2026 it was still called "AI Gateway". Exact rename date not found (unverified). |
| **Declarative Automation Bundles** | Databricks Asset Bundles (DABs) | 16 Mar 2026 | CI/CD and infrastructure as code through the Databricks CLI. |
| **OpenSharing** | Delta Sharing | 10 Jun 2026 | Objects are the same: share, recipient, provider. Protocols: Databricks-to-Databricks (D2D), Databricks-to-Open (bearer token or OIDC federation). SecureConnect (GA Aug 2026) shares data from storage behind a firewall. |
| **Genie One** | Databricks One | 2026 (date unverified) | Simple UI for business users: dashboards, chat, apps. Exists at workspace level and at account level. |
| **Genie Agents** | Genie spaces | 8 Jul 2026 | Natural-language Q&A over data. |
| **Genie Code** | Databricks Assistant | 11 Mar 2026 | Coding agent inside the workspace. |
| **AI Search** | (Mosaic AI) Vector Search | 1 Jun 2026 | Now also full-text indexes. |
| **Model Serving** (serving endpoints) | Mosaic AI Model Serving | gradual | Release notes still said "Mosaic AI Model Serving" in Apr 2026 and "Model Serving" from June. "Mosaic AI" survives only as a feature-table label. The umbrella for AI is now **Agent Bricks**. |
| **Databricks SQL warehouses** | | | Types: **serverless**, **pro**, **classic**. Plus **Lakehouse Real-Time (Lakehouse//RT)**, a serverless type in Beta (Jun 2026). |
| **AI/BI dashboards** | Lakeview dashboards | | Viewers see them through Genie One. |
| **Databricks Apps** | | GA May 2025 | Hosted apps; can use Lakebase as backend. |
| **Lakebase** (Lakebase Postgres) | "OLTP Database" tab | Preview Jun 2025 | Managed Postgres: projects, branches, synced tables, registered in Unity Catalog. Has Autoscaling and Provisioned variants. GA status not confirmed (unverified). |
| **Lakehouse Federation** | | | Query federation (foreign catalogs on external databases) and catalog federation. OneLake catalog federation GA Jun 2026. |
| **Serverless compute** | | | Notebooks and jobs GA Jul 2024. Serverless workspaces GA Jan 2026. |
| **Standard / Dedicated access mode** | Shared / Single user (assigned) | 2024-25 | See section 7. |
| **Git folders** | Repos | Mar 2024 | |
| **Catalog Explorer** | Data Explorer | Sep 2023 | |

Sources: L/release-notes/product/ (index), L/release-notes/product/2026/march, L/release-notes/product/2026/june, L/release-notes/product/2026/july, L/release-notes/product/2026/april, L/release-notes/product/2026/august, L/ldp/, L/ingestion/lakeflow-connect/, L/genie-one/, L/opensharing/, L/compute/sql-warehouse/warehouse-types, L/oltp/projects/

---

## 2. Architecture and networking

### Planes
- **Control plane**: the backend services that Databricks runs in its own account, including the web app. It is not in your subscription.
- **Classic compute plane**: VMs in your Azure subscription, in the workspace VNet. Azure Databricks provisions them in the **managed resource group** (default name `databricks-rg-<workspace>-<hash>`). You cannot modify that group, and Azure protects it with a deny assignment.
- **Serverless compute plane**: runs in the Databricks account, in the same region as the workspace, inside a network boundary for each workspace. Traffic between the control plane and serverless compute always stays on the cloud backbone.
- **Two workspace types**:
  - **Serverless workspace**: serverless compute plus **default storage** (Databricks-managed). Databricks recommends starting with this type.
  - **Classic workspace**: shown as **"Hybrid"** in the Azure portal. Has customer-managed storage and compute, and can still use serverless.
- Source: L/getting-started/high-level-architecture, L/lakehouse-architecture/deployment-guide/workspace-strategy

### Workspace storage (classic)
- The **workspace storage account** sits in the managed resource group. Its name usually begins with `dbstorage`. It holds workspace system data, the DBFS root (legacy), and sometimes the automatically created **workspace catalog**.
- **Firewall support** for this storage account requires Premium, VNet injection, SCC, and an extra private endpoint subnet of at least `/28`.
- You create two private endpoints to it, with sub-resources **`dfs`** and **`blob`**. Cloud Fetch clients (BI tools) need private endpoints too.
- Enabling the firewall attaches a Databricks-provisioned network security perimeter (`databricks-nsp`) that allows the `AzureDatabricksServerless` service tag. Public network access then shows as Disabled.
- Enabling it through CLI or PowerShell **deletes the access connector in the managed resource group**. Create a replacement access connector outside that group first.
- Source: L/security/network/storage/firewall-support

### VNet injection (classic compute plane)
- VNet: `/16` to `/24`, in the same region and same subscription as the workspace.
- Two dedicated subnets:
  - **host** subnet (also called the "public" subnet)
  - **container** subnet (also called the "private" subnet)
- Subnet size: `/26` or larger is recommended. `/28` is the technical minimum. Both subnets should be the same size.
- Each node uses 2 IPs (one per subnet), and Azure reserves 5 IPs per subnet.
- Subnets cannot be shared across workspaces or used for other resources. Subnet CIDRs cannot be changed after deployment (expansion only through the account team).
- Both subnets are **delegated to `Microsoft.Databricks/workspaces`**, and each must have an NSG attached. Databricks recommends a **unique NSG per workspace**. Databricks auto-provisions the NSG rules through the delegation (network intent policy); do not edit them.
- **NSG rules managed by Databricks**:
  - inbound: VirtualNetwork→VirtualNetwork, any port
  - inbound, only when SCC is off: AzureDatabricks→22 and AzureDatabricks→5557
  - outbound: AzureDatabricks on 443, 3306, 8443-8451
  - outbound: Storage on 443
  - outbound: EventHub on 9093
  - outbound: Sql on 3306 (being removed for new workspaces)
  - outbound: VirtualNetwork→VirtualNetwork, any port
- **`requiredNsgRules`** values:
  - `AllRules`: front-end Private Link only
  - `NoAzureDatabricksRules`: back-end Private Link or full isolation
- An existing workspace can be migrated from the managed VNet to VNet injection (GA 2 Mar 2026). Hardening of the intra-VNet NSG rule is in Public Preview (Jun 2026).
- Source: L/security/network/classic/vnet-inject, L/security/network/concepts/privatelink-concepts, L/release-notes/product/2026/march, L/release-notes/product/2026/june

### Secure cluster connectivity (SCC, "No Public IP") and outbound traffic
- With SCC, the VNet has no open ports and nodes have no public IP. Clusters dial out to the **SCC relay** on 443.
- SCC is the default in the portal and in ARM (`enableNoPublicIp` defaults to true from API 2024-05-01). Default for new workspaces since Mar 2025. Databricks plans to make SCC mandatory for classic workspaces.
- **Managed VNet**: Databricks auto-creates a NAT gateway in the managed resource group.
- **VNet injection**: put an **Azure NAT gateway on both subnets** for a stable egress IP, or route through a firewall/NVA with a **UDR**. Do not use an egress load balancer.
- **Default outbound access retirement**: VNets created after **31 Mar 2026** have no implicit internet access, so new workspaces need an explicit outbound method. Existing workspaces are not affected.
- Allowlist the SCC relay by FQDN, not by IP.
- New dedicated regional control planes arrived in Oct 2026 (West US 2, South Central US, Australia Southeast). Firewall allowlists must be updated for these.
- Source: L/security/network/classic/secure-cluster-connectivity, L/release-notes/product/2026/october

### Private Link (three kinds)
- **Inbound (front-end)**: user → workspace. Private endpoint sub-resource **`databricks_ui_api`**, placed in the **transit (hub) VNet**. Needs Premium, VNet injection and SCC.
- **Classic (back-end)**: compute plane → control plane (REST and SCC relay). Uses a `databricks_ui_api` private endpoint in a **classic private endpoint subnet** (`/27`) in the workspace VNet.
- **Outbound (serverless)**: serverless → customer resources, through NCC private endpoint rules.
- **Web auth endpoint `browser_authentication`**:
  - Needed for browser SSO over Private Link.
  - Only **one per region per private DNS zone**; it serves every workspace in that region.
  - Best practice: a dedicated **"private web auth workspace"** (example name `WEB_AUTH_DO_NOT_DELETE_<region>`) with public access Disabled, `NoAzureDatabricksRules`, a delete lock, no workloads, and no `databricks_ui_api` endpoint.
  - If that workspace is deleted, browser login fails for the whole region.
  - Transit VNet subnet sizes: `/26` to `/25` for the PE subnet, `/28` or `/27` for each subnet of the web-auth workspace.
- **New endpoint types**:
  - `general_access` (Beta): account console, account-level Genie One, custom URL; works across regions.
  - `service_direct`: Lakebase Autoscaling, Zerobus.
- **DNS**:
  - Private DNS zone **`privatelink.azuredatabricks.net`**, with A records for `adb-<id>.<n>` (workspace) and `<region>.pl-auth` (SSO).
  - Conditional forwarders for `*.azuredatabricks.net`, `*.privatelink.azuredatabricks.net`, `*.databricksapps.com`.
- Two access models:
  - **No public access**
  - **Hybrid**: public access stays on, controlled by context-based ingress control (GA for public access Jul 2026; for private endpoints Oct 2026) and IP access lists.
- Source: L/security/network/concepts/privatelink-concepts, L/security/network/front-end/front-end-private-connect, L/release-notes/product/2026/october

### Serverless networking
- **NCC (network connectivity configuration)**: an account-level, regional object that you attach to workspaces in the same region.
  - Limits: up to 50 workspaces per NCC, 20 NCCs per region per account, 100 private endpoints per region.
  - Holds **private endpoint rules** to customer resources (ADLS, Azure SQL, and so on). The customer approves the PE request on the resource. Hourly PE charges go to a chosen billing workspace (Preview Oct 2026).
  - An NCC can also be attached to a metastore for OpenSharing SecureConnect.
- **Storage firewall without a PE**:
  - Serverless reaches same-region storage over **service endpoints**.
  - Allowing serverless **subnet IDs no longer works**. Instead, associate the storage account with a **network security perimeter (NSP)** in transition mode, add an inbound rule for service tag **`AzureDatabricksServerless.<Region>`**, and keep storage public access on "Enabled from selected networks".
  - For other resources, allowlist the published outbound IPs from `ip-ranges.json` and refresh them on a schedule. The legacy stable-IP list was decommissioned.
- **Private network gateway** (Private Preview Aug 2026): one managed gateway for serverless egress to a VNet, on-premises or the internet, reusing the NCC.
- **Serverless egress control (network policies)**:
  - A **network policy** is an account-level object. One policy per workspace; one policy can cover many workspaces.
  - Modes: **Full access** or **Restricted access**. Restricted allows only UC external locations, listed FQDNs and storage accounts, and the workspace's own APIs. Supports dry-run.
  - Applies to notebooks, jobs, SQL warehouses, pipelines, Model Serving, Apps (limited), and MCP services.
  - GA Jun 2025.
- Source: L/security/network/serverless-network-security/, L/security/network/serverless-network-security/serverless-firewall-config, L/security/network/serverless-network-security/network-policies, L/release-notes/product/2026/august

### Access connector for Azure Databricks
- Resource type **`Microsoft.Databricks/accessConnectors`**. A first-party Azure resource that holds a **system-assigned** managed identity, one or more **user-assigned** identities, or both.
- Used by:
  - UC **storage credentials** (and through them, external locations and managed storage)
  - metastore root storage
  - the workspace storage firewall
- Grant **Storage Blob Data Contributor** on the account, or Storage Blob Delegator on the account plus Contributor on a container.
- File events need these roles: Storage Queue Data Contributor, Storage Account Contributor, EventGrid EventSubscription Contributor.
- Firewalled storage: add a **resource instance rule** for `Microsoft.Databricks/accessConnectors`.
- Guidance: use separate connectors per storage account or domain (example names `uc-prod-sales-connector`).
- Source: L/connect/unity-catalog/cloud-storage/azure-managed-identities, L/lakehouse-architecture/deployment-guide/unity-catalog

---

## 3. Unity Catalog object model

- **Hierarchy**: account → **metastore** (one per region; attached to every workspace in that region; each workspace has exactly one metastore) → **catalog** → **schema** → objects. Namespace is `catalog.schema.object`.
- **Objects inside a schema**:
  - tables: managed, external, foreign
  - views, materialized views, metric views, streaming tables (as tables)
  - volumes: managed, external
  - functions (UDFs and stored procedures; **registered models are a kind of function**)
  - models
  - services (model services, model provider services, MCP services, agent services; Beta)
  - secrets (GA Aug 2026)
  - features
  - flows (Beta Nov 2026)
- **Objects directly under the metastore**:
  - storage credentials, external locations
  - service credentials, connections
  - external metadata
  - shares, recipients, providers
  - clean rooms
- **Managed storage**:
  - Can be set at metastore, catalog or schema level. Data goes to the lowest level that is set.
  - **Metastore-level storage is no longer required**, and Databricks recommends not using it. Prefer **catalog-level storage** as the unit of isolation.
  - The managed location of a catalog or schema can be changed (GA Apr 2026).
- **Default storage**: Databricks-managed storage used by serverless workspaces; it needs no storage credential.
- **Managed vs external**: use managed tables and volumes for all new data. External tables fit Hive metastore migration, non-Delta/Iceberg formats, or external writers. External volumes fit landing and raw zones. Use one external location per schema.
- **Automatic enablement**:
  - Workspaces created after **9 Nov 2023** get Unity Catalog automatically. The metastore is auto-created and assigned.
  - The **default workspace catalog** is stored in the workspace storage account and is **bound only to its own workspace**. The workspace admins group owns it. Its name is said to match the workspace name (unverified).
  - The catalog survives workspace deletion unless you force-delete it.
- **Workspace-catalog binding**:
  - Catalogs are `OPEN` to all attached workspaces by default.
  - Set `ISOLATED`, then bind workspaces as `BINDING_TYPE_READ_WRITE` or `BINDING_TYPE_READ_ONLY`. A binding overrides grants.
  - You can also bind external locations, storage credentials and service credentials.
- **Privileges (names as documented)**:
  - Usage: `USE CATALOG`, `USE SCHEMA`.
  - `BROWSE`: catalog level only; metadata only. Recommended for `All account users`.
  - Data: `SELECT`, `MODIFY` (Beta adds `INSERT`/`UPDATE`/`DELETE`), `READ VOLUME`, `WRITE VOLUME`, `EXECUTE` (functions, models, services), `REFRESH` (materialized views).
  - Create: `CREATE CATALOG`, `CREATE SCHEMA`, `CREATE TABLE`, `CREATE VOLUME`, `CREATE FUNCTION`, `CREATE MODEL`, `CREATE MATERIALIZED VIEW`, `CREATE EXTERNAL LOCATION`, `CREATE STORAGE CREDENTIAL`, `CREATE MANAGED STORAGE`, `CREATE CONNECTION`, `CREATE SHARE`, `CREATE RECIPIENT`, `CREATE PROVIDER`.
  - Files: `READ FILES`, `WRITE FILES` (on external locations; use sparingly).
  - Tags and external access: `APPLY TAG`, `EXTERNAL USE SCHEMA`, `EXTERNAL USE LOCATION`.
  - Connections and secrets: `USE CONNECTION`, `READ SECRET`.
  - Admin: `MANAGE` (grant, transfer and drop without being owner; not part of `ALL PRIVILEGES`), `MANAGE ACCESS CONTROL`, `READ METADATA` (auditor view, child of `MANAGE`), `ALL PRIVILEGES`.
  - Ownership: the creator is the first owner. Owners of a catalog or schema can grant on every child object. Assign ownership to groups.
- **Inheritance**: grants flow down from catalog and schema. Grants on the metastore do not inherit, except `READ METADATA`.
- **ABAC**:
  - **Governed tags GA 2 Apr 2026**; **ABAC row filter and column mask policies GA 28 Apr 2026**. Policies attach at catalog, schema or table level and match by governed tag.
  - Breaking change at GA: policies on views are now evaluated as the session user.
  - Cross-engine ABAC GA 1 Oct 2026.
  - ABAC GRANT policies GA for models and services (Aug 2026).
  - DENY policies: Beta.
  - Data Classification (auto-tagging): GA Apr 2026.
- **System tables**:
  - `system.billing.usage`
  - `system.access.audit`
  - `system.access.table_lineage`, `system.access.column_lineage`
  - `system.access.inbound_network` (ingress denials)
  - `system.lakeflow.*` (jobs, pipelines)
  - `system.compute.*`; the legacy `compute_preview` schema is deprecated
  - `system.tags.governed_tags` (Beta)
- **Lineage**:
  - Automatic, built per metastore; it does not cross regions.
  - **External lineage** (formerly Bring Your Own Lineage) GA Jun 2026: register outside sources and BI dashboards as external metadata.
  - Lakeflow Connect records lineage from source tables.
- Sources: L/data-governance/unity-catalog/, L/data-governance/unity-catalog/securable-objects, L/data-governance/unity-catalog/access-control/privileges-reference, L/data-governance/unity-catalog/best-practices, L/data-governance/unity-catalog/access-control/workspace-catalog-binding, L/catalogs/default, L/release-notes/product/2026/april, L/release-notes/product/2026/june

---

## 4. Identity

- Users, service principals and groups live at the **account level**. Workspaces receive them through **workspace assignment** by an account admin or workspace admin.
- **Identity federation** is on by default for all new workspaces (since Jun 2026, also for workspaces without a UC metastore) and cannot be turned off.
- **Automatic identity management (AIM)** with Entra ID:
  - GA Sep 2025. **On by default for accounts created after 1 Aug 2025.** Databricks recommends it over SCIM.
  - Syncs users, groups, **nested groups** and **service principals**. Needs no Entra admin role or extra enterprise app. JIT provisioning is always on.
  - Entra is the source of record; synced identities show as **External**. Users deleted in Entra are deactivated automatically (Feb 2026).
  - Groups are created at account level automatically, but **workspace assignment is still a manual step**.
  - Limits: no cross-tenant directories. Nested groups that are not provisioned directly are not visible to the API or Terraform.
- **SCIM provisioning** (account-level Entra enterprise app):
  - The fallback option. Syncs direct group members only and **no service principals**.
  - Turn off workspace-level SCIM.
  - Do not mix SCIM with AIM for the same identities.
- **Groups**: **account groups** are the standard. **Workspace-local groups are legacy**; migrate them to account groups through the IdP. The built-in workspace `admins` group is workspace-local.
- **Service principals**: two kinds.
  - **Azure Databricks-managed**: authenticate with Databricks OAuth or PATs. Recommended for automation.
  - **Microsoft Entra ID-managed**: authenticate with OAuth or Entra tokens. Use when the same identity also needs other Azure resources.
  - Roles on a service principal: **Service principal manager** and **Service principal user** (run as).
  - OAuth on-behalf-of for service principals: GA Nov 2026.
- **Admin roles**:
  - **account admin**
  - **workspace admin**
  - **metastore admin**: optional; not set when UC is enabled automatically; can take ownership of anything, so use a group
  - **group manager**, **service principal manager**
  - With auto-enabled UC, workspace admins get `CREATE CATALOG`, `CREATE STORAGE CREDENTIAL` and `CREATE EXTERNAL LOCATION`
- **RBAC** (assume a role for a session) GA Aug 2026. Identity attributes (title, department) are in Beta for ABAC.
- **Recommendations**:
  - Manage groups in the IdP.
  - Grant to groups, not users. Give groups ownership.
  - Run production jobs as service principals. Give `MODIFY` on production tables only to service principals.
- Sources: L/admin/users-groups/, L/admin/users-groups/automatic-identity-management/, L/admin/users-groups/service-principals, L/data-governance/unity-catalog/best-practices, L/release-notes/product/2026/june, L/release-notes/product/2026/november

---

## 5. Recommended topology

- **Workspaces**:
  - Split SDLC environments into separate workspaces: at least **dev and prod**, often **dev / staging / prod**, each with its own network and storage.
  - Split for:
    - different business units that must not share admins or assets
    - regulated data
    - different feature or security needs (Private Link, CMK, AI features are set per workspace)
    - regions
    - subscription limits
  - **Do not** create workspaces per team or small project; use catalogs and schemas instead.
  - Avoid more than **50-100 workspaces** unless you have strong justification and automation (Terraform, bundles).
  - Create an **administrative workspace per region** for managing UC.
  - Workspace naming: `{organization}-{environment}-{region}-{purpose}`, lowercase with hyphens, under 50 characters (e.g. `acme-prod-eu-west-gdpr`).
- **Metastore**: **one per region**, shared by dev, test and prod and all business units. Across regions or clouds, use **D2D OpenSharing**. Do not register the same external table in two metastores. Alternatives (per business unit or per environment) are rare.
- **Catalogs**: the primary unit of isolation. Patterns:
  - **environment-based** (`dev`, `staging`, `prod`): the default
  - **domain-based** (`sales`, `finance`): fits data mesh
  - **hybrid** (`sales_prod`, `sales_dev`, `finance_prod`)
  - **data-lifecycle** (`raw`, `curated`, `analytics`)
  - Typically 3-10 catalogs per metastore. Use schemas, not catalogs, for teams and projects. Give individuals and teams sandbox schemas.
- **Keep prod data out of dev**: set the prod catalog to `ISOLATED` and bind it only to prod workspace(s). Dev can get a read-only binding if needed.
- **Storage**: catalog-level managed storage, with separate storage accounts, storage credentials and access connectors per environment and per domain.
  - Stripe across storage accounts for heavy workloads (each ADLS account has a 20,000 requests/s limit).
  - Never reuse the DBFS root container.
  - Do not store production data on DBFS.
- **Hub-and-spoke catalogs**: a hub catalog (`prod_hub`) holds shared master and reference data; spoke catalogs hold each domain. Each catalog has its own credential and external location.
- **Medallion**:
  - Layers are **bronze (raw) → silver (validated) → gold (enriched / dimensional)**.
  - Databricks' example puts the layers as **schemas within a catalog** (`ops.bronze`, `ops.silver`, `ops.gold`). Catalog-per-layer is also listed as an option.
  - Multiple gold layers per domain are fine.
  - Bronze: store fields as string, VARIANT or binary.
- **Compute**: use compute policies. Standard access mode by default; dedicated only when standard does not support the workload.
- **Governance model**: Databricks suggests starting with **federated** governance, and centralized for highly regulated industries.
- Sources: L/lakehouse-architecture/deployment-guide/workspace-strategy, L/lakehouse-architecture/deployment-guide/unity-catalog, L/data-governance/unity-catalog/best-practices, L/lakehouse/medallion
- Also relevant, not read in full: https://learn.microsoft.com/en-us/azure/well-architected/service-guides/azure-databricks

---

## 6. Azure resource naming (CAF abbreviations, exactly as the page lists them)

Page: https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations (ms.date 2025-05-23, read 2026-11-14)

| Resource (as written on page) | Namespace (as written) | Abbr. | Expected? |
|---|---|---|---|
| Azure Databricks workspace | `Microsoft.Databricks/workspaces` | `dbw` | yes |
| Azure Databricks Access Connector | `Microsoft.Databricks/workspaces/accessConnectors` | `dbac` | yes (see note) |
| Storage account | `Microsoft.Storage/storageAccounts` | `st` | yes |
| Private endpoint | `Microsoft.Network/privateEndpoints` | `pep` | yes |
| Virtual network | `Microsoft.Network/virtualNetworks` | `vnet` | yes |
| Virtual network subnet | `Microsoft.Network/virtualNetworks/subnets` | `snet` | yes |
| Network security group (NSG) | `Microsoft.Network/networkSecurityGroups` | `nsg` | yes |
| Resource group | `Microsoft.Resources/resourceGroups` | `rg` | yes |
| Event Hubs namespace | `Microsoft.EventHub/namespaces` | `evhns` | yes |
| Key vault | `Microsoft.KeyVault/vaults` | `kv` | yes |
| NAT gateway | `Microsoft.Network/natGateways` | `ng` | yes |
| Azure SQL database | `Microsoft.Sql/servers/databases` | `sqldb` | yes |
| Azure SQL Database server | `Microsoft.Sql/servers` | `sql` | yes |
| Firewall | `Microsoft.Network/azureFirewalls` | `afw` | yes |
| Managed identity | `Microsoft.ManagedIdentity/userAssignedIdentities` | `id` | yes |
| Log Analytics workspace | `Microsoft.OperationalInsights/workspaces` | `log` | yes |
| Route table | `Microsoft.Network/routeTables` | `rt` | yes |

Other names useful in diagrams:

| Resource | Abbr. |
|---|---|
| Firewall policy | `afwp` |
| Network interface | `nic` |
| Public IP address | `pip` |
| User defined route | `udr` |
| Virtual network peering | `peer` |
| Network security perimeter | `nsp` |
| Private Link | `pl` |
| Virtual WAN hub | `vhub` |
| DNS private resolver | `dnspr` |
| Azure Data Factory | `adf` |
| Event hub | `evh` |
| Data Lake Store account | `dls` |
| Microsoft Purview instance | `pview` |
| Fabric capacity | `fc` |
| Application Insights | `appi` |
| Azure Monitor Private Link Scope | `ampls` |
| Management group | `mg` |
| Azure Machine Learning workspace | `mlw` |
| Foundry account | `aif` |
| Azure OpenAI | `oai` |

- Private DNS zones take the DNS domain name instead of an abbreviation (e.g. `privatelink.azuredatabricks.net`).
- **Note**: the CAF row gives the access connector namespace as `Microsoft.Databricks/workspaces/accessConnectors`. The real ARM type used in Databricks docs and resource IDs is `Microsoft.Databricks/accessConnectors`.

---

## 7. What changed recently (2025-2026)

**Defaults**
- **Unity Catalog** is on automatically for workspaces created after 9 Nov 2023 (older change, still the baseline).
- **SCC (No Public IP)** is the default for new workspaces (Mar 2025). SCC will become mandatory for classic workspaces (date not given).
- **Automatic identity management** is on by default for accounts created after 1 Aug 2025 (GA Sep 2025).
- **Identity federation** is on by default for all new workspaces (Jun 2026).
- **Legacy features off for new accounts**: accounts created after **18 Dec 2025** have no DBFS root and mounts, no Hive metastore, and no No-isolation shared compute. Existing accounts have the "Disable legacy features" setting (GA 11 Dec 2025) and "Disable access to Hive metastore". "Disable DBFS root and mounts" became GA Nov 2025.
- **Account-level security features** (private connectivity, ingress and egress controls, encryption) are available to all accounts at GA without a preview toggle (Oct 2026).

**Tiers and storage**
- **Standard tier retired on Azure**: no new Standard workspaces since **1 Apr 2026**; remaining ones auto-upgrade to Premium from **1 Oct 2026** (phased).
- **Serverless**:
  - notebooks and jobs GA Jul 2024
  - egress control GA Jun 2025
  - serverless workspaces GA Jan 2026
  - serverless in UK West Jul 2026
  - standalone pipelines on serverless general compute GA Nov 2026
  - JAR tasks on serverless GA Aug 2026
- **Storage firewall access from serverless** moved from subnet IDs and stable IPs to an **NSP plus the `AzureDatabricksServerless` service tag**, or NCC private endpoints. The legacy stable-IP list was decommissioned.

**Network**
- **Default outbound access**: VNets created after 31 Mar 2026 have no implicit internet access, so use a NAT gateway or firewall.
- **Networking charges** for cross-region and internet egress from Lakebase, OpenSharing SecureConnect, Zerobus and the Files API (Jul 2026).

**Compute access modes**
- **Standard** (formerly Shared) and **Dedicated** (formerly Single user / Assigned). Dedicated can now be assigned to a **group**.
- **Auto** is the default in the compute form: it picks Standard unless an ML runtime, GPU, or DBR below 14.3 is chosen.
- New **jobs compute** defaults to Auto, not Dedicated (9 Nov 2026).
- **No-isolation shared** is legacy and disabled for new accounts.
- Use only standard or dedicated with UC.

**Governance**
- **ABAC GA** (Apr 2026), **governed tags GA** (Apr 2026), **RBAC GA** (Aug 2026), **Secrets in UC GA** (Aug 2026), **Unity Gateway GA** (Aug 2026), **Discover page and domains GA** (Oct 2026), **external lineage GA** (Jun 2026), customer-managed keys for UC catalogs (Mar 2026).
- Managed disaster recovery Public Preview (Jun 2026). It needs the Mission Critical add-on and a custom URL with `general_access` PEs.

**Renames** (see section 1)
- DLT → Lakeflow pipelines
- Workflows → Lakeflow Jobs
- DABs → Declarative Automation Bundles
- Delta Sharing → OpenSharing
- Databricks One → Genie One
- Genie spaces → Genie Agents
- Assistant → Genie Code
- Vector Search → AI Search
- AI Gateway → Unity Gateway (date unverified)

Sources: L/release-notes/product/2025/december, L/release-notes/product/2026/march, L/release-notes/product/2026/april, L/release-notes/product/2026/june, L/release-notes/product/2026/july, L/release-notes/product/2026/august, L/release-notes/product/2026/october, L/release-notes/product/2026/november, L/admin/account-settings/standard-tier, L/compute/configure, L/lakehouse-architecture/deployment-guide/workspace-strategy

---

## Uncertain / check

1. **Genie One rename date**: "previously known as Databricks One" is confirmed; the date was not found.
2. **AI Gateway → Unity Gateway**: the two names appear in Apr and Aug 2026 notes. No explicit rename note was found.
3. **Lakebase GA status**: Autoscaling vs Provisioned are both mentioned; GA was not confirmed.
4. **Default workspace catalog naming**: that it matches the workspace name is not confirmed on the pages read.
5. **Pipelines naming**: both "Spark Declarative Pipelines on Lakeflow" (page title) and "Lakeflow pipelines" (body text, newer notes) are in use. Pick one label and show the other as an alias.
6. **Model Serving**: whether "Mosaic AI" is fully dropped is unclear; the Standard-tier table still lists "Mosaic/AI".
7. **CAF access connector namespace** (`Microsoft.Databricks/workspaces/accessConnectors`) differs from the real ARM type (`Microsoft.Databricks/accessConnectors`). The CAF page is dated 2025-05-23.
8. **SCC mandatory date** for classic workspaces is announced on the "What's coming" page; the date was not read.
9. **`Sql` service-tag NSG rule (3306)** is being removed for new workspaces; the exact rollout was not checked.
10. **Workspace-count and catalog guidance** comes from the Databricks deployment guide (phases 2-3). The Azure Well-Architected service guide was not read in full.
