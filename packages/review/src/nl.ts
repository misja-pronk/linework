// The review in Dutch: what each rule says (title, why, fix, docs), what its check finds, and the
// words of the report. The English is the id (see packages/i18n); rules stay written in English
// and are said in Dutch when the drawing has `lang: nl`.
import { lookup, translator, type Catalog, type Lang } from '@cartography/i18n';
import type { RuleInfo } from './types.ts';

export const nl = {
  // The words around findings.
  Error: 'Fout',
  Warning: 'Waarschuwing',
  Info: 'Info',
  Errors: 'Fouten',
  Warnings: 'Waarschuwingen',
  Security: 'Beveiliging',
  Reliability: 'Betrouwbaarheid',
  'Operational excellence': 'Operationele uitmuntendheid',
  'Performance efficiency': 'Prestatie-efficiëntie',
  'Cost optimisation': 'Kostenoptimalisatie',
  'the diagram': 'het diagram',
  'Review rule {id} could not run: {error}': 'Reviewregel {id} kon niet draaien: {error}',

  // The report.
  'No findings in {count} diagram|No findings in {count} diagrams': 'Geen bevindingen in {count} diagram|Geen bevindingen in {count} diagrammen',
  ' ({count} set aside)': ' ({count} terzijde gelegd)',
  '{count} finding|{count} findings': '{count} bevinding|{count} bevindingen',
  '{count} error|{count} errors': '{count} fout|{count} fouten',
  '{count} warning|{count} warnings': '{count} waarschuwing|{count} waarschuwingen',
  '{count} info': '{count} info',
  'in {files} of {count} diagrams': 'in {files} van {count} diagrammen',
  'in the diagram': 'in het diagram',
  '; {count} set aside': '; {count} terzijde gelegd',
  ' Reviewed {date}.': ' Beoordeeld op {date}.',
  Pillar: 'Pijler',
  'Not reviewed: the file says {off}.': 'Niet beoordeeld: het bestand zegt {off}.',
  'No findings.': 'Geen bevindingen.',
  '{title}, with the findings marked': '{title}, met de bevindingen gemarkeerd',
  'About {about}': 'Over {about}',
  ' in view {view}': ' in weergave {view}',
  ' · view {view}': ' · weergave {view}',
  Why: 'Waarom',
  Fix: 'Oplossing',
  Read: 'Lees meer',
  'Set aside': 'Terzijde gelegd',
  Rule: 'Regel',
  About: 'Over',
  Reason: 'Reden',
  '(no reason given)': '(geen reden opgegeven)',
  'no reason given': 'geen reden opgegeven',
  'Rules: {count} rule|Rules: {count} rules': 'Regels: {count} regel|Regels: {count} regels',
  ' from {packs}': ' uit {packs}',
  '; settings from {files}': '; instellingen uit {files}',
  '. Each rule, its reason and its fix: docs/review.md.': '. Elke regel met reden en oplossing: docs/review.md.',
  'Architecture review': 'Architectuurreview',
  Summary: 'Samenvatting',
  'no findings': 'geen bevindingen',
  '{about}, as drawn': '{about}, zoals getekend',
  'Nothing to report on this diagram.': 'Niets te melden over dit diagram.',
  '{count} rule ran|{count} rules ran': '{count} regel gedraaid|{count} regels gedraaid',
  ', with the settings of {files}': ', met de instellingen van {files}',
  'Made with Cartography: {command}.': 'Gemaakt met Cartography: {command}.',

  // Customer rules (rules.yaml).
  'A rule of this organisation.': 'Een regel van deze organisatie.',
  '{name} should have {what}': '{name} hoort {what} te hebben',
  '{name} should not have {what}': '{name} hoort geen {what} te hebben',
  '{line}: no line should go from {from} to {to}': '{line}: er hoort geen lijn van {from} naar {to} te lopen',
  'Nothing here has {what}': 'Niets hier heeft {what}',
  'not {what}': 'niet {what}',
  ' or ': ' of ',

  // Azure.
  'Public endpoints sit behind a WAF': 'Publieke endpoints staan achter een WAF',
  'An app reached straight from the internet takes every bot, scan and injection attempt itself.': 'Een app die rechtstreeks vanaf internet bereikbaar is, vangt zelf elke bot, scan en injectiepoging op.',
  'Put Front Door (with a WAF policy) or an Application Gateway WAF_v2 in front, and draw the line through it; or set public: false when it is only reached privately':
    'Zet Front Door (met een WAF-policy) of een Application Gateway WAF_v2 ervoor en teken de lijn erdoorheen; of zet public: false als hij alleen privé bereikbaar is',
  'Azure Web Application Firewall on Front Door or Application Gateway': 'Azure Web Application Firewall op Front Door of Application Gateway',
  '{name} is reached from {from} without a WAF in front': '{name} wordt vanaf {from} bereikt zonder WAF ervoor',
  '{name} takes traffic from {from} on the {tier} tier, without its WAF': '{name} krijgt verkeer van {from} op de tier {tier}, zonder WAF',
  '{name} is public, and no Front Door or Application Gateway WAF is in front of it': '{name} is publiek en er staat geen Front Door of WAF van een Application Gateway voor',

  'Data stores in a network design are reached through a private endpoint': 'Datastores in een netwerkontwerp zijn bereikbaar via een private endpoint',
  'A database or storage account on its public endpoint is one firewall rule away from the internet, whatever the network around the apps.':
    'Een database of storage account op zijn publieke endpoint staat één firewallregel van internet af, hoe het netwerk rond de apps ook is ingericht.',
  'Add a private endpoint in a subnet (kind: private-endpoint, a line to the store) and turn public network access off; or draw the store in the subnet its endpoint is in. public: false says it is private':
    'Voeg een private endpoint in een subnet toe (kind: private-endpoint, met een lijn naar de datastore) en zet public network access uit; of teken de datastore in het subnet van zijn endpoint. public: false zegt dat hij privé is',
  'Azure Private Link and private endpoints': 'Azure Private Link en private endpoints',
  '{name} is public, in a design with a virtual network': '{name} is publiek, in een ontwerp met een virtueel netwerk',
  '{name} has no private endpoint: it is reached on its public endpoint': '{name} heeft geen private endpoint: hij wordt via zijn publieke endpoint bereikt',

  'Apps keep their secrets in Key Vault': 'Apps bewaren hun secrets in Key Vault',
  'Connection strings and keys in app settings or code leak with every copy of the configuration and are never rotated.':
    'Connection strings en sleutels in app settings of code lekken mee met elke kopie van de configuratie en worden nooit geroteerd.',
  "Read secrets from Key Vault with the app's managed identity (a line to the key-vault, style identity), or connect with the managed identity itself (style: identity on the line to the store)":
    'Lees secrets uit Key Vault met de managed identity van de app (een lijn naar de key-vault, style identity), of maak verbinding met de managed identity zelf (style: identity op de lijn naar de datastore)',
  'Azure Key Vault and managed identities': 'Azure Key Vault en managed identities',
  '{name} connects to {store} and reads no secrets from Key Vault': '{name} maakt verbinding met {store} en haalt geen secrets uit Key Vault',
  'No Key Vault is drawn, and {count} apps connect to stores that need a secret: {names}': 'Er is geen Key Vault getekend, en {count} apps maken verbinding met datastores die een secret nodig hebben: {names}',

  'Production survives the loss of a zone': 'Productie overleeft het uitvallen van een zone',
  'A production workload in one zone of one region goes down with that datacentre.': 'Een productieworkload in één zone van één regio gaat mee onderuit met dat datacenter.',
  'Set zones: 3 (or zones: redundant) on what must stay up, or draw a second region group for a paired-region setup':
    "Zet zones: 3 (of zones: redundant) op wat in de lucht moet blijven, of teken een tweede regiogroep voor een opzet met gekoppelde regio's",
  'Azure availability zones and multi-region design': "Azure availability zones en ontwerpen over meerdere regio's",
  'Production is drawn in one region, and nothing in it says it is zone-redundant': 'Productie is in één regio getekend, en niets daarin zegt dat het zone-redundant is',

  'Resources send diagnostics to Log Analytics': 'Resources sturen diagnostische gegevens naar Log Analytics',
  'Without logs and metrics in one place nobody sees an outage, an attack or a cost spike until a user does.': 'Zonder logs en metrics op één plek ziet niemand een storing, een aanval of een kostenpiek voordat een gebruiker die ziet.',
  'Draw the Log Analytics workspace (or Application Insights) and the diagnostics lines to it, style management; badges: [management] keeps them out of the way':
    'Teken de Log Analytics-workspace (of Application Insights) en de diagnostische lijnen ernaartoe, style management; badges: [management] houdt ze uit beeld',
  'Azure Monitor diagnostic settings': 'Diagnostische instellingen van Azure Monitor',
  'Nothing here sends logs or metrics anywhere: no Log Analytics, Application Insights or diagnostics line': 'Niets hier stuurt logs of metrics ergens heen: geen Log Analytics, Application Insights of diagnostische lijn',

  'AKS clusters enforce network policy': 'AKS-clusters dwingen network policies af',
  'Without a network policy engine every pod can reach every other pod, so one compromised pod reaches the whole cluster.': 'Zonder network policy engine kan elke pod elke andere pod bereiken, dus één gecompromitteerde pod bereikt het hele cluster.',
  'Turn on a network policy engine (props: { network-policy: azure } or calico, cilium) and write policies per namespace': 'Zet een network policy engine aan (props: { network-policy: azure } of calico, cilium) en schrijf policies per namespace',
  'AKS network policies': 'Network policies in AKS',
  '{name} has no network policy engine': '{name} heeft geen network policy engine',

  'AKS API servers are private': 'API-servers van AKS zijn privé',
  'A public Kubernetes API server is a target for credential stuffing and the next CVE, from anywhere.': 'Een publieke API-server van Kubernetes is van overal een doelwit voor credential stuffing en de volgende CVE.',
  'Make it a private cluster (props: { private-cluster: true }), or at least limit authorized IP ranges (props: { authorized-ip-ranges: … })':
    'Maak er een private cluster van (props: { private-cluster: true }), of beperk op zijn minst de toegestane IP-bereiken (props: { authorized-ip-ranges: … })',
  'AKS private clusters and API server authorized IP ranges': 'Private clusters in AKS en toegestane IP-bereiken voor de API-server',
  'The API server of {name} is public': 'De API-server van {name} is publiek',

  'Storage accounts allow no anonymous access': 'Storage accounts staan geen anonieme toegang toe',
  'Anonymous blob access hands every file to whoever guesses the URL; it is how most cloud data leaks start.': 'Met anonieme blobtoegang krijgt iedereen die de URL raadt elk bestand; zo beginnen de meeste datalekken in de cloud.',
  'Disallow blob public access on the account and serve public files through Front Door with a private origin; then set public: false':
    'Zet publieke blobtoegang op het account uit en serveer publieke bestanden via Front Door met een private origin; zet daarna public: false',
  'Prevent anonymous read access to Azure Storage': 'Anonieme leestoegang tot Azure Storage voorkomen',
  '{name} allows public access': '{name} staat publieke toegang toe',

  'People get broad roles through groups, not directly': 'Mensen krijgen brede rollen via groepen, niet rechtstreeks',
  'Owner or Contributor on a whole subscription, held by a person directly, is never reviewed when they change jobs and is the first thing an attacker uses.':
    'Owner of Contributor op een hele subscription, rechtstreeks aan een persoon toegekend, wordt bij een functiewissel nooit herzien en is het eerste wat een aanvaller gebruikt.',
  'Give the role to a group (with an access review), or make it eligible through PIM; keep standing Owner for break-glass accounts only':
    'Ken de rol toe aan een groep (met een access review), of maak hem eligible via PIM; houd permanent Owner alleen voor break-glass-accounts',
  'Azure RBAC best practices and Privileged Identity Management': 'Best practices voor Azure RBAC en Privileged Identity Management',
  '{who} is {role} on {scope} directly': '{who} is rechtstreeks {role} op {scope}',

  // AWS.
  'Internet-facing load balancers have AWS WAF': 'Load balancers aan internet hebben AWS WAF',
  'An internet-facing ALB without a web ACL passes every injection, scan and bot straight to the app.': 'Een ALB aan internet zonder web ACL laat elke injectie, scan en bot rechtstreeks door naar de app.',
  'Associate an AWS WAF web ACL with the ALB, or put CloudFront with WAF in front and draw the line through it; tags: [waf] or a waf node beside it says so':
    'Koppel een AWS WAF web ACL aan de ALB, of zet CloudFront met WAF ervoor en teken de lijn erdoorheen; tags: [waf] of een waf-element ernaast zegt dat hij er is',
  'AWS WAF with Application Load Balancer and CloudFront': 'AWS WAF met Application Load Balancer en CloudFront',
  '{name} is internet-facing and no WAF is on it or in front of it': '{name} hangt aan internet en heeft geen WAF erop of ervoor',

  'Production databases are Multi-AZ': 'Productiedatabases zijn Multi-AZ',
  'A single-AZ RDS instance is down for the length of a zone outage or a host failure, and its backups restore slowly.':
    'Een RDS-instance in één AZ ligt plat zolang een zone of host uitvalt, en zijn backups zijn traag terug te zetten.',
  'Turn on Multi-AZ (props: { multi-az: true }) or run an Aurora cluster with a replica in another zone, and draw it there': 'Zet Multi-AZ aan (props: { multi-az: true }) of draai een Aurora-cluster met een replica in een andere zone, en teken die daar',
  'Amazon RDS Multi-AZ deployments': 'Multi-AZ-deployments van Amazon RDS',
  '{name} runs in one availability zone': '{name} draait in één availability zone',

  'S3 buckets block public access': 'S3-buckets blokkeren publieke toegang',
  'A public bucket hands its objects to anyone with the URL; most AWS data leaks are one.': 'Een publieke bucket geeft zijn objecten aan iedereen met de URL; de meeste datalekken bij AWS beginnen zo.',
  'Turn on Block Public Access for the bucket and the account, and serve public files through CloudFront with origin access control; then set public: false':
    'Zet Block Public Access aan voor de bucket en het account, en serveer publieke bestanden via CloudFront met origin access control; zet daarna public: false',
  'Amazon S3 Block Public Access': 'Amazon S3 Block Public Access',
  '{name} is public': '{name} is publiek',

  'Accounts record API calls and metrics': 'Accounts leggen API-aanroepen en metrics vast',
  'Without CloudTrail and CloudWatch nobody can say who changed what, or see trouble before users do.': 'Zonder CloudTrail en CloudWatch kan niemand zeggen wie wat heeft gewijzigd, en ziet niemand problemen eerder dan de gebruikers.',
  'Draw the CloudTrail trail (organisation-wide) and CloudWatch the workloads report to; tags: [monitoring] on a shared logging account says it is elsewhere':
    'Teken de CloudTrail-trail (voor de hele organisatie) en de CloudWatch waar de workloads aan rapporteren; tags: [monitoring] op een gedeeld logging-account zegt dat ze elders staan',
  'AWS CloudTrail and Amazon CloudWatch': 'AWS CloudTrail en Amazon CloudWatch',
  'No CloudTrail or CloudWatch is drawn': 'Er is geen CloudTrail of CloudWatch getekend',

  'Each zone has its own NAT gateway': 'Elke zone heeft een eigen NAT gateway',
  'One NAT gateway for private subnets in several zones takes all their outbound traffic down with its zone, and costs cross-zone data.':
    'Eén NAT gateway voor private subnets in meerdere zones neemt bij uitval van zijn zone al hun uitgaande verkeer mee, en kost dataverkeer tussen zones.',
  "Run one NAT gateway per availability zone, each in that zone's public subnet, and route each private subnet to the one in its zone":
    'Draai één NAT gateway per availability zone, elk in het publieke subnet van die zone, en routeer elk private subnet naar de NAT gateway in zijn eigen zone',
  'NAT gateways per availability zone': 'NAT gateways per availability zone',
  'One NAT gateway serve private subnets in {zones} zones|{count} NAT gateways serve private subnets in {zones} zones': 'Eén NAT gateway bedient private subnets in {zones} zones|{count} NAT gateways bedienen private subnets in {zones} zones',

  // Kubernetes.
  'Workloads set resource limits': 'Workloads hebben resource limits',
  "A pod without limits can take a node's memory and CPU from everything else on it, and the scheduler cannot plan for it.":
    'Een pod zonder limits kan al het geheugen en de CPU van een node opeisen ten koste van de rest, en de scheduler kan er niet op plannen.',
  'Set requests and limits on every container and write them down (props: { limits: cpu 500m · memory 512Mi }); a LimitRange per namespace catches the rest':
    'Zet requests en limits op elke container en schrijf ze op (props: { limits: cpu 500m · memory 512Mi }); een LimitRange per namespace vangt de rest op',
  'Kubernetes resource management for pods and containers': 'Resourcebeheer voor pods en containers in Kubernetes',
  '{name} has no resource limits': '{name} heeft geen resource limits',

  'Services are not exposed one by one as load balancers': 'Services worden niet elk apart als load balancer ontsloten',
  'Each LoadBalancer service is a public address of its own, outside the ingress where TLS, auth and rate limits live.': 'Elke LoadBalancer-service is een eigen publiek adres, buiten de ingress waar TLS, authenticatie en rate limits zitten.',
  'Route the traffic through an ingress or Gateway; when a load balancer is needed, make it internal (props: { internal: true }) or public: false':
    'Leid het verkeer via een ingress of Gateway; is een load balancer nodig, maak hem dan intern (props: { internal: true }) of public: false',
  'Kubernetes Ingress and Gateway API': 'Kubernetes Ingress en Gateway API',
  '{name} is exposed to the outside as a load balancer, not through an ingress': '{name} is naar buiten ontsloten als load balancer, niet via een ingress',

  'Namespaces have a NetworkPolicy': 'Namespaces hebben een NetworkPolicy',
  'Without a policy every pod accepts traffic from every other pod in the cluster: one compromised pod reaches all.': 'Zonder policy accepteert elke pod verkeer van elke andere pod in het cluster: één gecompromitteerde pod bereikt ze allemaal.',
  'Add a default-deny NetworkPolicy to the namespace and allow what is drawn; draw it (kind: networkpolicy) so the review sees it':
    'Geef de namespace een default-deny NetworkPolicy en sta toe wat getekend is; teken die (kind: networkpolicy) zodat de review hem ziet',
  'Kubernetes network policies': 'Network policies in Kubernetes',
  'No namespace of {cluster} has a NetworkPolicy: {names}': 'Geen enkele namespace van {cluster} heeft een NetworkPolicy: {names}',
  'Namespace {name} has no NetworkPolicy': 'Namespace {name} heeft geen NetworkPolicy',

  'Secrets are mounted as files, not environment variables': 'Secrets worden als bestand gemount, niet als omgevingsvariabelen',
  'Environment variables end up in crash dumps, logs and child processes; a mounted file does not, and can be rotated in place.':
    'Omgevingsvariabelen belanden in crashdumps, logs en childprocessen; een gemount bestand niet, en dat kun je ter plekke roteren.',
  'Mount the Secret as a volume (or use the Secrets Store CSI driver with a vault) and label the line volume': 'Mount de Secret als volume (of gebruik de Secrets Store CSI-driver met een vault) en geef de lijn het label volume',
  'Kubernetes Secrets good practices': 'Goede praktijken voor Kubernetes Secrets',
  '{name} reads {secret} as environment variables': '{name} leest {secret} als omgevingsvariabelen',

  // Systems and C4.
  'Outside parties reach data through a service': 'Externe partijen bereiken data via een service',
  "A person or another company's system writing to a database directly bypasses every check, log and limit a service would apply.":
    'Een persoon of een systeem van een ander bedrijf dat rechtstreeks naar een database schrijft, omzeilt elke controle, log en limiet van een service.',
  'Put an API or service in front of the store that authenticates, validates and logs; draw the line through it': 'Zet een API of service voor de datastore die authenticeert, valideert en logt; teken de lijn erdoorheen',
  '{from} reaches {to} directly': '{from} bereikt {to} rechtstreeks',

  'Synchronous call chains stay short': 'Synchrone aanroepketens blijven kort',
  'Every synchronous hop adds latency and multiplies the chance of failure: five services at 99.9 % each are up 99.5 % together.':
    'Elke synchrone stap voegt latency toe en vergroot de kans op falen: vijf services die elk 99,9 % beschikbaar zijn, zijn samen 99,5 % beschikbaar.',
  'Cut the chain: answer from a cache or a read model, or hand the rest of the work to a queue (an async line); max-chain in rules.yaml sets how deep is too deep':
    'Knip de keten door: antwoord uit een cache of een read model, of geef de rest van het werk aan een wachtrij (een asynchrone lijn); max-chain in rules.yaml bepaalt hoe diep te diep is',
  '{count} synchronous calls in a row: {chain}': '{count} synchrone aanroepen achter elkaar: {chain}',

  'What many depend on runs more than once': 'Waar veel van afhangt, draait vaker dan één keer',
  'One instance with many dependents takes them all down when it fails or is patched.': 'Eén instance waar veel van afhangt, neemt alles mee onderuit als hij uitvalt of gepatcht wordt.',
  'Run it at least twice, in different zones, and say so: props: { count: 2 } (count: on a deployment node), zones: 3 or tags: [ha]':
    'Draai hem minstens twee keer, in verschillende zones, en zeg dat: props: { count: 2 } (count: op een deployment node), zones: 3 of tags: [ha]',
  '{name} runs once and {count} elements depend on it': '{name} draait één keer en {count} elementen hangen ervan af',

  'Services do not call each other in a circle': 'Services roepen elkaar niet in een kring aan',
  'A cycle of synchronous calls deadlocks under load, retries amplify through it, and none of the services can be deployed alone.':
    'Een kring van synchrone aanroepen loopt onder load vast, retries versterken zich erin, en geen van de services kan los worden uitgerold.',
  'Break the cycle: let one side publish an event instead of calling back, or move what both need into one service': 'Doorbreek de kring: laat één kant een event publiceren in plaats van terug te roepen, of breng wat beide nodig hebben onder in één service',
  '{names} call each other in a circle': '{names} roepen elkaar in een kring aan',

  // GitHub.
  'Default branches are protected': 'Default branches zijn beschermd',
  'Without a ruleset or branch protection anyone with write access can push to main, skip review and rewrite history.': 'Zonder ruleset of branch protection kan iedereen met schrijfrechten naar main pushen, de review overslaan en de geschiedenis herschrijven.',
  'Add a ruleset on the default branch (pull request with review, status checks, no force push) and draw it in the repository, or a protects line from an organisation ruleset':
    'Zet een ruleset op de default branch (pull request met review, status checks, geen force push) en teken die in de repository, of een protects-lijn vanuit een ruleset van de organisatie',
  'GitHub rulesets and branch protection': 'Rulesets en branch protection in GitHub',
  '{name} has no ruleset or branch protection on its default branch': '{name} heeft geen ruleset of branch protection op de default branch',

  'Admin rights stay with few people per repository': 'Adminrechten blijven per repository bij weinig mensen',
  "A team that is admin everywhere can turn off every protection; its members' tokens are the organisation's keys.": 'Een team dat overal admin is, kan elke bescherming uitzetten; de tokens van zijn leden zijn de sleutels van de organisatie.',
  'Give the team maintain or write and keep admin to a small platform group; admin-above in rules.yaml sets how many repositories are many':
    'Geef het team maintain of write en houd admin bij een kleine platformgroep; admin-above in rules.yaml bepaalt hoeveel repositories te veel is',
  'GitHub repository roles for an organisation': 'Repositoryrollen in een GitHub-organisatie',
  '{name} is admin on {count} repositories': '{name} is admin op {count} repositories',

  'Outside collaborators are never admin': 'Outside collaborators zijn nooit admin',
  'An admin from outside the organisation can change who has access and turn off protection, outside your offboarding.': 'Een admin van buiten de organisatie kan wijzigen wie toegang heeft en de bescherming uitzetten, buiten je offboarding om.',
  'Give the collaborator write or maintain, or make them a member under your SSO': 'Geef de collaborator write of maintain, of maak hem lid onder je SSO',
  'Outside collaborator {name} is admin on {repo}': 'Outside collaborator {name} is admin op {repo}',

  // Data products.
  'Output ports that others read have a data contract': 'Output ports die anderen lezen hebben een datacontract',
  'Without a contract a consumer builds on whatever the port happens to hold today, and every change of it breaks someone silently.':
    'Zonder contract bouwt een afnemer op wat er vandaag toevallig in de port zit, en breekt elke wijziging ongemerkt iets bij iemand.',
  'Write a data contract for the port (contracts: with fields, SLA and quality, or file: an ODCS file) and set contract: on the port':
    'Schrijf een datacontract voor de port (contracts: met velden, SLA en kwaliteit, of file: een ODCS-bestand) en zet contract: op de port',
  'Open Data Contract Standard (ODCS)': 'Open Data Contract Standard (ODCS)',
  '{product}: output port {port} is read by others and has no data contract': '{product}: output port {port} wordt door anderen gelezen en heeft geen datacontract',
  'No output port has a data contract yet, and {count} are read by others': 'Nog geen enkele output port heeft een datacontract, en {count} worden door anderen gelezen',

  'Contracts with personal data say how it is classified': 'Contracten met persoonsgegevens zeggen hoe die geclassificeerd zijn',
  'Personal data without a classification gets copied, joined and kept like any other data: a GDPR breach waiting for an audit.':
    'Persoonsgegevens zonder classificatie worden gekopieerd, gekoppeld en bewaard als alle andere data: een AVG-overtreding die op een audit wacht.',
  'Set classification: on the contract (confidential, restricted, …) and keep the pii marks on the fields': 'Zet classification: op het contract (confidential, restricted, …) en houd de pii-markeringen op de velden',
  'ODCS classification and GDPR data classification': 'Classificatie in ODCS en dataclassificatie onder de AVG',
  'Contract {name} has personal data and no classification': 'Contract {name} bevat persoonsgegevens en heeft geen classificatie',
} as const satisfies Record<string, string>;

/** The review's words in a language: t(m.lang, '{name} is public', { name }). */
export const t = translator(nl);
/** Words known at run time (a severity's or pillar's label, a rule's title): the Dutch when there is one. */
export const say = lookup(nl);

/** A rule as said in a language: its title, why, fix and docs; a customer's own rule stays as written. */
export function ruleIn(lang: Lang | undefined, r: RuleInfo): RuleInfo {
  if (lang !== 'nl') return r;
  // As written when there is no Dutch: a customer's title may hold a "|" or "{…}" of its own.
  const as = (s: string) => (nl as Catalog)[s] ?? s;
  return { ...r, title: as(r.title), why: as(r.why), fix: as(r.fix), ...(r.docs ? { docs: as(r.docs) } : {}) };
}
