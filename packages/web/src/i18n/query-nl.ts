// "Beschrijf wat je wilt laten zien": the start dialog ranks types by English keywords, so a Dutch
// query is read word by word into English first. Words not here stay as typed (IT terms are the same:
// cluster, API, Kubernetes), and the English words stay too, so a mixed query works.
const WORDS: Record<string, string> = {
  // who and what
  gebruiker: 'user', gebruikers: 'users', klant: 'customer', klanten: 'customers', medewerker: 'user', medewerkers: 'users',
  persoon: 'person', personen: 'people', rol: 'role', rollen: 'roles', team: 'team', teams: 'teams', organisatie: 'organization',
  afdeling: 'team', afdelingen: 'teams', eigenaar: 'owner', eigenaren: 'owners', leverancier: 'vendor', partner: 'partner',
  // access
  toegang: 'access', rechten: 'permissions', bevoegdheden: 'permissions', autorisatie: 'authorization', inloggen: 'login',
  identiteit: 'identity', geheimen: 'secrets', sleutels: 'keys', beveiliging: 'security',
  aanval: 'attack', aanvallen: 'attacks', risico: 'risk', risicos: 'risks', vertrouwensgrens: 'trust boundary',
  // systems and infrastructure
  systeem: 'system', systemen: 'systems', landschap: 'landscape', applicatie: 'application', applicaties: 'applications',
  netwerk: 'network', netwerken: 'networks', omgeving: 'environment', omgevingen: 'environments', uitrol: 'deployment',
  server: 'server', servers: 'servers', opslag: 'storage', wachtrij: 'queue', berichten: 'messages', bericht: 'message',
  gebeurtenis: 'event', gebeurtenissen: 'events', koppeling: 'integration', koppelingen: 'integrations', afhankelijkheden: 'dependencies',
  infrastructuur: 'infrastructure', wolk: 'cloud', regio: 'region', kosten: 'cost',
  // data
  gegevens: 'data', tabel: 'table', tabellen: 'tables', kolommen: 'columns', datamodel: 'data model', relaties: 'relationships',
  rapport: 'report', rapportage: 'report', dataproduct: 'data product', dataproducten: 'data products', contract: 'contract',
  // flow and time
  proces: 'process', processen: 'processes', stroom: 'flow', stappen: 'steps', stap: 'step', volgorde: 'sequence',
  aanroep: 'call', aanroepen: 'calls', verzoek: 'request', antwoord: 'response', toestand: 'state', toestanden: 'states',
  status: 'status', levenscyclus: 'lifecycle', tijdlijn: 'timeline', planning: 'roadmap', plan: 'plan', kwartaal: 'quarter',
  mijlpaal: 'milestone', mijlpalen: 'milestones', fasen: 'phases', fase: 'phase', reis: 'journey', klantreis: 'customer journey',
  goedkeuring: 'approval', besluit: 'decision', besluiten: 'decisions', beslissingen: 'decisions',
  // structure and ideas
  klasse: 'class', klassen: 'classes', objecten: 'objects', overerving: 'inheritance', vermogens: 'capabilities',
  capabilities: 'capabilities', domein: 'domain', domeinen: 'domains', ideeën: 'ideas', ideeen: 'ideas', onderwerpen: 'topics',
  brainstormen: 'brainstorm', matrix: 'matrix', vergelijking: 'comparison', overzicht: 'overview',
  verantwoordelijk: 'responsible', verantwoordelijkheden: 'responsibilities', takken: 'branches', samenvoegen: 'merge',
  // little words that only say "show me"
  wie: 'who', welke: 'which', wat: 'what', heeft: 'has', hebben: 'have', tussen: 'between', naar: 'to', van: 'of', met: 'with',
};

/** A query in English words, for the type matcher. */
export const englishQuery = (query: string) =>
  query
    .split(/(\s+)/)
    .map((w) => WORDS[w.toLowerCase().replace(/[^a-zà-ÿ0-9]/g, '')] ?? w)
    .join('');
