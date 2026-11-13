// Roles, groups and access packages (Entra ID governance and Azure RBAC), in four views:
//   graph     who may request → access package → group / app role → role on scope
//             (an eligible assignment, activated through PIM, is drawn dashed)
//   access    who × where, the effective role, and where it comes from
//   packages  access packages × what they grant
//   roles     roles × permissions, including inherited ones
import {
  english,
  idPattern,
  tones,
  type BuildContext,
  type DiagramType,
  type Graph,
  type GraphEdge,
  type GraphGroup,
  type GraphNode,
  type KindTable,
  type LegendItem,
  type LinePattern,
  type MatrixCell,
  type MatrixHeader,
  type PaletteItem,
  type Reference,
  type Tone,
  type Word,
} from '@cartography/core';

export const principalKinds: KindTable = {
  user: { label: 'User', icon: 'user', tone: 'slate' },
  guest: { label: 'Guest', icon: 'user-round', tone: 'orange', keywords: ['b2b', 'external user'] },
  group: { label: 'Security group', icon: 'users', tone: 'blue', keywords: ['sg'] },
  'dynamic-group': { label: 'Dynamic group', icon: 'users', tone: 'teal' },
  'role-assignable-group': { label: 'Role-assignable group', icon: 'shield-user', tone: 'violet' },
  'm365-group': { label: 'Microsoft 365 group', icon: 'users', tone: 'sky' },
  'service-principal': { label: 'Service principal', icon: 'bot', tone: 'indigo', keywords: ['sp', 'enterprise app', 'enterprise application'] },
  'managed-identity': { label: 'Managed identity', icon: 'id-card', tone: 'indigo', keywords: ['mi', 'msi', 'uami'] },
  // The definition of an application (client id, credentials, API permissions); its service principal is what holds roles.
  'app-registration': { label: 'App registration', icon: 'file-badge', tone: 'indigo', keywords: ['appreg', 'app reg', 'application', 'client id'] },
  // Lets a workload outside Entra (GitHub Actions, Kubernetes) sign in as an app with its platform's token: no secret.
  'federated-credential': { label: 'Federated credential', icon: 'link', tone: 'indigo', keywords: ['fic', 'federation', 'oidc', 'workload identity federation'] },
  device: { label: 'Device', icon: 'laptop', tone: 'slate', keywords: ['laptop', 'intune', 'endpoint'] },
  paw: { label: 'Privileged access workstation', icon: 'laptop-minimal-check', tone: 'rose', keywords: ['paw', 'admin workstation', 'saw'] },
  'connected-org': { label: 'Connected organisation', icon: 'handshake', tone: 'orange' },
  // What an export names but no longer finds: a deleted user or group that still holds a role.
  unknown: { label: 'Identity not found', icon: 'circle-question-mark', tone: 'rose' },
};

export const resourceKinds: KindTable = {
  tenant: { label: 'Tenant', icon: 'building-complex', tone: 'slate' },
  'management-group': { label: 'Management group', icon: 'layers', tone: 'slate' },
  subscription: { label: 'Subscription', icon: 'folder-key', tone: 'amber' },
  'resource-group': { label: 'Resource group', icon: 'boxes', tone: 'slate' },
  resource: { label: 'Resource', icon: 'box', tone: 'slate' },
  database: { label: 'Database', icon: 'database', tone: 'indigo' },
  'key-vault': { label: 'Key Vault', icon: 'key-round', tone: 'amber' },
  storage: { label: 'Storage', icon: 'archive', tone: 'teal' },
  app: { label: 'Application', icon: 'app-window', tone: 'blue' },
  'sharepoint-site': { label: 'SharePoint site', icon: 'book-open', tone: 'teal' },
  organization: { label: 'Organisation', icon: 'building', tone: 'slate' },
  repo: { label: 'Repository', icon: 'folder-git-2', tone: 'slate' },
  'directory-role': { label: 'Directory role', icon: 'shield-user', tone: 'violet' },
  // A scope for Entra roles: a role assigned on it covers only the users, groups and devices in it.
  'administrative-unit': { label: 'Administrative unit', icon: 'folder', tone: 'violet' },
};

/** Conditional Access, and what its policies ask for: drawn before the people they apply to. */
export const policyKinds: KindTable = {
  'conditional-access': { label: 'Conditional Access policy', icon: 'shield-half', tone: 'rose', keywords: ['ca', 'ca policy', 'conditional access'] },
  'authentication-strength': { label: 'Authentication strength', icon: 'fingerprint-pattern', tone: 'amber', keywords: ['mfa', 'fido2', 'passkey', 'phishing-resistant'] },
  'named-location': { label: 'Named location', icon: 'map-pin', tone: 'teal', keywords: ['location', 'ip range', 'country', 'trusted network'] },
  'compliance-policy': { label: 'Device compliance policy', icon: 'badge-check', tone: 'green', keywords: ['compliance', 'compliant', 'intune'] },
};

/**
 * Each kind of line: its entry in the key, and (as the line's kind) what describe says it does. Its
 * second mark (pattern) is fixed, so a package's grant looks the same in every access diagram: the most
 * common line of each kind (a role assignment, a request, a membership) is plain. The rare ones without
 * a pattern get one only when they meet a line they would be told apart from by colour alone.
 */
const edgeStyles = {
  holds: { label: 'Holds package', line: 'solid', tone: 'green', kind: 'Holds', pattern: 'beads' },
  request: { label: 'Can request', line: 'dashed', tone: 'slate' },
  grant: { label: 'Package grants', line: 'solid', tone: 'violet', kind: 'Grants', pattern: 'ticks' },
  member: { label: 'Member of', line: 'dotted', tone: 'slate', kind: 'Member of' },
  owns: { label: 'Owns', line: 'dashed', tone: 'amber', kind: 'Owns', pattern: 'beads' },
  instance: { label: 'App and its service principal', line: 'solid', tone: 'indigo', kind: 'Service principal' },
  federated: { label: 'Federated credential of the app', line: 'dotted', tone: 'indigo', kind: 'Federated credential of', pattern: 'beads' },
  role: { label: 'Role assignment', line: 'solid', tone: 'sky', kind: 'Role assignment' },
  eligible: { label: 'Eligible, activated through PIM', line: 'dashed', tone: 'sky', kind: 'Eligible', pattern: 'ticks' },
  applies: { label: 'Policy applies to', line: 'solid', tone: 'rose', kind: 'Applies to', pattern: 'double' },
  excludes: { label: 'Excluded from the policy', line: 'dotted', tone: 'rose', kind: 'Excludes', loose: true, pattern: 'ticks' },
  requires: { label: 'Policy requires', line: 'dashed', tone: 'rose', kind: 'Requires', loose: true, pattern: 'double' },
  location: { label: 'Location condition', line: 'dotted', tone: 'teal', kind: 'Location condition', loose: true, pattern: 'double' },
  covers: { label: 'Policy covers app', line: 'solid', tone: 'slate', kind: 'Covers' },
} as const satisfies Record<string, { label: string; line: GraphEdge['line']; tone: Tone; kind?: string; loose?: boolean; pattern?: LinePattern }>;

interface Principal {
  kind?: string;
  label?: string;
  caption?: string;
  'member-of'?: string | string[];
  /** Who owns it (a group's or an app's owners). */
  owners?: string | string[];
  /** A service principal's or a federated credential's app registration. */
  app?: string;
  /** The object id in the directory: an import recognises the principal by it, whatever it is called here. */
  'object-id'?: string;
  tags?: string[];
}

interface Resource {
  kind?: string;
  label?: string;
  caption?: string;
  in?: string;
  /** The id where it lives (an Azure resource id, a repository's full name): as object-id, for imports. */
  'resource-id'?: string;
  tags?: string[];
}

/** A package's way in: who may request, who approves, for how long. */
interface Policy {
  /** Its own id, for steps and focus; otherwise it is <package>:policy:<n>. */
  id?: string;
  requestors?: string | string[];
  approval?: string | string[];
  duration?: string;
  review?: string;
  /** Assigned automatically to the requestors (auto-assignment policy). */
  auto?: boolean;
}

/** A Conditional Access policy, or what one asks for: an authentication strength, a named location, device compliance. */
interface Control {
  kind?: string;
  label?: string;
  caption?: string;
  /** Who it applies to: users, groups, directory roles. */
  targets?: string | string[];
  /** Who it leaves out: the break-glass accounts. */
  excludes?: string | string[];
  /** The apps it covers: resource ids, or words such as "All cloud apps". */
  apps?: string | string[];
  /** Named locations it checks. */
  locations?: string | string[];
  /** What a sign-in needs: an authentication strength, a device, a PAW, or words such as MFA. */
  requires?: string | string[];
  /** Blocks access instead of granting it. */
  block?: boolean;
  state?: 'on' | 'report-only' | 'off';
  tags?: string[];
}

/** An assignment in full: with the settings Privileged Identity Management (PIM) activates an eligible one with. */
interface Assignment {
  principal: string;
  role: string;
  scope: string;
  eligible?: boolean;
  /** How long one activation lasts at most, e.g. 8 h. */
  activation?: string;
  /** Who approves an activation: principal ids or words. */
  approval?: string | string[];
  tags?: string[];
}

interface Package {
  label?: string;
  caption?: string;
  catalog?: string;
  /** Group ids (membership), or { resource: role } for app and site roles. */
  grants?: (string | Record<string, string>)[];
  policy?: Policy | Policy[];
  /** Who holds the package now; used by the access view. */
  holders?: string[];
  'object-id'?: string;
  tags?: string[];
}

interface Role {
  label?: string;
  inherits?: string | string[];
  permissions?: string[];
  tone?: Tone;
  /** The role definition's id, for imports. */
  'role-id'?: string;
  /** Held somewhere inside the scope, not on all of it: what an import writes for scopes it folded away. */
  part?: boolean;
}

interface Catalog {
  label?: string;
  'object-id'?: string;
}

export interface AccessSource {
  title?: string;
  subtitle?: string;
  direction?: 'right' | 'down';
  view?: 'graph' | 'access' | 'packages' | 'roles';
  principals?: Record<string, string | Principal>;
  catalogs?: Record<string, string | Catalog | null>;
  packages?: Record<string, Package>;
  resources?: Record<string, string | Resource>;
  roles?: Record<string, Role | null>;
  /** Conditional Access policies and what they use. */
  policies?: Record<string, string | Control>;
  /** "who is role on scope", or "who is eligible role on scope" for a role that is activated through PIM. */
  assignments?: (string | Assignment)[];
  /** An earlier state of the same diagram: the who × where matrix then shows what was gained and lost. Written by `carto diff`. */
  was?: AccessSource;
}

const list = (v: string | string[] | undefined) => (v == null ? [] : Array.isArray(v) ? v : [v]);
// "sg-ops is owner on prod", or "sg-ops is eligible owner on prod" (PIM). Groups: principal, eligible, role, scope.
const ASSIGNMENT = /^\s*([A-Za-z0-9_-]+)\s+is\s+(?:(eligible)\s+)?([A-Za-z0-9_-]+)\s+on\s+([A-Za-z0-9_-]+)\s*$/;

/** Everything resolved once, shared by all views. */
class Model {
  principals: [string, Principal][];
  resources: [string, Resource][];
  packages: [string, Package][];
  roles: [string, Role][];
  catalogs: [string, Catalog][];
  controls: [string, Control][];
  assignments: (Assignment & { eligible: boolean; path: (string | number)[] })[] = [];

  /** The words the drawing adds itself, in its language. */
  word: Word;

  constructor(
    public src: AccessSource,
    private ctx: BuildContext,
  ) {
    this.word = ctx.word ?? english;
    const norm = <T>(o: Record<string, string | T | null> | undefined, key: string) =>
      Object.entries(o ?? {}).map(([id, v]) => [id, (typeof v === 'string' ? { [key]: v } : (v ?? {})) as T] as [string, T]);
    this.principals = norm<Principal>(src.principals, 'kind');
    this.resources = norm<Resource>(src.resources, 'kind');
    this.packages = Object.entries(src.packages ?? {});
    this.roles = Object.entries(src.roles ?? {}).map(([id, r]) => [id, r ?? {}]);
    this.catalogs = norm<Catalog>(src.catalogs, 'label');
    this.controls = norm<Control>(src.policies, 'kind');

    for (const [i, a] of (src.assignments ?? []).entries()) {
      const path = ['assignments', i];
      const m = typeof a === 'string' ? ASSIGNMENT.exec(a) : null;
      const v = typeof a === 'string' ? (m ? { principal: m[1]!, role: m[3]!, scope: m[4]!, eligible: !!m[2] } : undefined) : a;
      if (!v) {
        ctx.error(path, 'An assignment reads "who is role on scope", e.g. "sg-devs is contributor on rg-dev"');
        continue;
      }
      if (!this.principal(v.principal)) ctx.error(path, `There is no principal "${v.principal}"`);
      else if (!this.role(v.role)) ctx.error(path, `There is no role "${v.role}"`);
      else if (!this.resource(v.scope)) ctx.error(path, `There is no resource "${v.scope}"`);
      else this.assignments.push({ ...v, eligible: !!v.eligible, path });
      if (typeof a === 'object' && !a.eligible && (a.activation || a.approval))
        ctx.warn(path, 'activation and approval are how PIM activates an eligible role: add eligible: true, or leave them out');
    }
    for (const [id, p] of this.principals) {
      for (const g of list(p['member-of'])) if (!this.principal(g)) ctx.error(['principals', id, 'member-of'], `There is no group "${g}"`);
      for (const o of list(p.owners)) if (!this.principal(o)) ctx.error(['principals', id, 'owners'], `There is no principal "${o}"`);
      if (p.app) {
        if (this.principal(p.app)?.kind !== 'app-registration') ctx.error(['principals', id, 'app'], `There is no app registration "${p.app}"`);
        else if (p.kind !== 'service-principal' && p.kind !== 'federated-credential')
          ctx.warn(['principals', id, 'app'], 'app: names the app registration of a service principal or a federated credential');
      }
    }
    for (const [id, c] of this.controls) {
      for (const key of ['targets', 'excludes'] as const)
        for (const t of list(c[key])) if (!this.principal(t) && !this.resource(t)) ctx.error(['policies', id, key], `There is no principal "${t}"`);
      for (const l of list(c.locations)) if (!this.control(l)) ctx.error(['policies', id, 'locations'], `There is no named location "${l}" under policies`);
    }
    // Every card has its own id: a package policy's own id may not be taken by anything else.
    const taken = new Set([...this.principals, ...this.resources, ...this.packages, ...this.controls].map(([id]) => id));
    for (const [id, p] of this.packages)
      for (const [i, pol] of this.policies(p).entries())
        if (pol.id && taken.has(pol.id)) ctx.error(['packages', id, 'policy', ...(Array.isArray(p.policy) ? [i] : []), 'id'], `"${pol.id}" is already the id of something else`);
        else if (pol.id) taken.add(pol.id);
    for (const [id, r] of this.resources) if (r.in && !this.resource(r.in)) ctx.error(['resources', id, 'in'], `There is no resource "${r.in}"`);
    for (const [id, r] of this.roles) for (const p of list(r.inherits)) if (!this.role(p)) ctx.error(['roles', id, 'inherits'], `There is no role "${p}"`);
    for (const [id, p] of this.packages) {
      if (p.catalog && !this.catalogs.some(([c]) => c === p.catalog)) ctx.error(['packages', id, 'catalog'], `There is no catalog "${p.catalog}"`);
      for (const [i, g] of this.grants(p).entries())
        if (!this.principal(g.target) && !this.resource(g.target)) ctx.error(['packages', id, 'grants', i], `There is no group or resource "${g.target}"`);
      for (const pol of this.policies(p))
        for (const r of list(pol.requestors)) if (!this.principal(r)) ctx.error(['packages', id, 'policy'], `There is no principal "${r}"`);
      for (const h of p.holders ?? []) if (!this.principal(h)) ctx.error(['packages', id, 'holders'], `There is no principal "${h}"`);
    }
  }

  principal = (id: string) => this.principals.find(([p]) => p === id)?.[1];
  resource = (id: string) => this.resources.find(([r]) => r === id)?.[1];
  role = (id: string) => this.roles.find(([r]) => r === id)?.[1];
  control = (id: string) => this.controls.find(([c]) => c === id)?.[1];
  label = (id: string) =>
    this.principal(id)?.label ??
    this.resource(id)?.label ??
    this.packages.find(([p]) => p === id)?.[1].label ??
    this.role(id)?.label ??
    this.control(id)?.label ??
    id;

  grants(p: Package): { target: string; role: string }[] {
    return (p.grants ?? []).flatMap((g) =>
      typeof g === 'string' ? [{ target: g, role: 'Member' }] : Object.entries(g).map(([target, role]) => ({ target, role: String(role) })),
    );
  }

  policies(p: Package): Policy[] {
    return Array.isArray(p.policy) ? p.policy : p.policy ? [p.policy] : [];
  }

  /** Approval stages in order, by name: "manager → Finance controller". */
  approvers(v: string | string[] | undefined): string {
    return list(v)
      .map((a) => (this.principal(a) ? this.label(a) : a))
      .join(' → ');
  }

  /** How an eligible assignment is activated, in words: "max 4 h, approval by sg-platform-admins". "4 h" never breaks over two lines. */
  activation(a: Assignment): string | undefined {
    const parts = [a.activation && this.word('max {time}', { time: a.activation.replace(/ /g, '\u00a0') }), list(a.approval).length && this.word('approval by {names}', { names: this.approvers(a.approval) })].filter(Boolean);
    return parts.length ? parts.join(', ') : undefined;
  }

  /** Groups a principal is in, directly or through other groups, with the first group on the path. */
  memberships(id: string): Map<string, string> {
    const out = new Map<string, string>();
    const walk = (p: string, via: string | undefined) => {
      for (const g of list(this.principal(p)?.['member-of'])) {
        if (out.has(g)) continue;
        out.set(g, via ?? g);
        walk(g, via ?? g);
      }
    };
    walk(id, undefined);
    return out;
  }

  ancestors(scope: string): string[] {
    const out: string[] = [];
    for (let s = this.resource(scope)?.in; s && !out.includes(s); s = this.resource(s)?.in) out.push(s);
    return out;
  }

  /** How strong a role is: the number of roles it includes. Used to show the strongest one. */
  rank(role: string, seen = new Set<string>()): number {
    if (seen.has(role)) return 0;
    seen.add(role);
    return 1 + list(this.role(role)?.inherits).reduce((s, r) => s + this.rank(r, seen), 0);
  }

  /** Whether a role is the other one or includes it, so activating the other adds nothing. */
  includes(role: string, other: string, seen = new Set<string>()): boolean {
    if (role === other) return true;
    if (seen.has(role)) return false;
    seen.add(role);
    return list(this.role(role)?.inherits).some((r) => this.includes(r, other, seen));
  }

  permissions(role: string, seen = new Set<string>()): Map<string, boolean> {
    const out = new Map<string, boolean>();
    if (seen.has(role)) return out;
    seen.add(role);
    for (const parent of list(this.role(role)?.inherits)) for (const p of this.permissions(parent, seen).keys()) out.set(p, false);
    for (const p of this.role(role)?.permissions ?? []) out.set(p, true);
    return out;
  }

  private assigned?: Map<string, Model['assignments']>;
  private inside?: Map<string, string[]>;

  /** A scope and everything in it. */
  covered(scope: string): string[] {
    if (!this.inside) {
      this.inside = new Map();
      for (const [id, r] of this.resources) if (r.in) this.inside.set(r.in, [...(this.inside.get(r.in) ?? []), id]);
    }
    const out: string[] = [];
    const walk = (s: string) => {
      if (out.includes(s)) return;
      out.push(s);
      for (const c of this.inside!.get(s) ?? []) walk(c);
    };
    walk(scope);
    return out;
  }

  /**
   * What a principal reaches: per scope every role it has there, the strongest first (a direct one before
   * an equally strong one from elsewhere), each with where it comes from: itself, a group, an access
   * package, a scope above.
   */
  reach(p: string): Map<string, Reach[]> {
    if (!this.assigned) {
      this.assigned = new Map();
      for (const a of this.assignments) this.assigned.set(a.principal, [...(this.assigned.get(a.principal) ?? []), a]);
    }
    // Identities p acts as: itself, its groups, and what its access packages give it.
    const groups = this.memberships(p);
    const sources: { id: string; via?: string }[] = [{ id: p }];
    for (const [g, via] of groups) sources.push({ id: g, via: this.label(via) });
    const out = new Map<string, Reach[]>();
    const add = (scope: string, r: Reach) => out.set(scope, [...(out.get(scope) ?? []), r]);
    const appRoles: { scope: string; role: string; via: string }[] = [];
    for (const [, pkg] of this.packages.filter(([, x]) => (x.holders ?? []).some((h) => h === p || groups.has(h)))) {
      const via = pkg.label ?? this.word('access package');
      for (const g of this.grants(pkg)) {
        if (this.principal(g.target)) {
          sources.push({ id: g.target, via });
          for (const [inner] of this.memberships(g.target)) sources.push({ id: inner, via });
        } else if (this.resource(g.target)) appRoles.push({ scope: g.target, role: g.role, via });
      }
    }
    for (const s of sources)
      for (const a of this.assigned.get(s.id) ?? [])
        for (const scope of this.covered(a.scope)) {
          const from = a.scope !== scope ? this.label(a.scope) : undefined;
          const role = this.role(a.role);
          const text = role?.label ?? a.role;
          const pim = a.eligible ? this.activation(a) : undefined;
          add(scope, {
            role: a.role,
            text: a.eligible ? this.word('{role} (eligible)', { role: text }) : text,
            direct: !s.via && !from,
            via: s.via,
            from,
            tone: role?.tone ?? 'indigo',
            ...(a.eligible ? { eligible: true } : {}),
            ...(pim ? { activation: pim } : {}),
          });
        }
    // App and site roles from a package: a fixed text, not one of the roles.
    for (const a of appRoles) add(a.scope, { text: a.role, direct: false, via: a.via, tone: 'indigo' });
    const rank = (r: Reach) => (r.role ? this.rank(r.role) : 0);
    for (const [scope, list] of out) {
      // What is held now before what has to be activated first: an eligible role is no standing access.
      list.sort((x, y) => Number(!!x.eligible) - Number(!!y.eligible) || rank(y) - rank(x) || Number(y.direct) - Number(x.direct));
      // One entry per role: the first way it is reached.
      out.set(scope, list.filter((r, i) => list.findIndex((x) => x.text === r.text) === i));
    }
    return out;
  }
}

/** One way a principal reaches a scope. */
export interface Reach {
  /** The role's id; none for an app or site role a package grants. */
  role?: string;
  /** The role as it is shown. */
  text: string;
  /** Assigned to the principal itself, on this very scope. */
  direct: boolean;
  /** The group or access package it comes through. */
  via?: string;
  /** The scope above it was assigned on. */
  from?: string;
  tone: Tone;
  /** Eligible only: activated through PIM when needed, not held until then. */
  eligible?: boolean;
  /** How it is activated: "max 4 h, approval by sg-platform-admins". */
  activation?: string;
}

const reachNote = (r: Reach, word: Word = english) => [r.via && word('via {name}', { name: r.via }), r.from && word('from {name}@scope', { name: r.from }), r.activation].filter(Boolean).join(', ') || undefined;

function principalHeader(m: Model, id: string): MatrixHeader {
  const p = m.principal(id)!;
  const k = principalKinds[p.kind ?? ''];
  return { label: p.label ?? id, caption: p.caption ?? (k && m.word(k.label)), icon: k?.icon, tone: k?.tone };
}

function resourceHeader(m: Model, id: string): MatrixHeader {
  const r = m.resource(id)!;
  const k = resourceKinds[r.kind ?? ''];
  return { label: r.label ?? id, caption: r.caption ?? (k && m.word(k.label)), icon: k?.icon, tone: k?.tone };
}

// ---------------------------------------------------------------- graph view

function graphView(m: Model): Graph {
  const groups: GraphGroup[] = [];
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const used = new Set<keyof typeof edgeStyles>();
  const edge = (from: string, to: string, style: keyof typeof edgeStyles, label: string | undefined, path: (string | number)[], tags?: string[], eligible?: GraphEdge['eligible']) => {
    used.add(style);
    const s: { line: GraphEdge['line']; tone: Tone; kind?: string; loose?: boolean; pattern?: LinePattern } = edgeStyles[style];
    edges.push({
      id: `e${edges.length}`,
      from: { node: from },
      to: { node: to },
      label,
      line: s.line,
      tone: s.tone,
      start: 'none',
      end: 'arrow',
      ...(s.kind ? { kind: s.kind } : {}),
      ...(s.pattern ? { pattern: s.pattern } : {}),
      ...(s.loose ? { loose: true } : {}),
      ...(tags?.length ? { tags } : {}),
      ...(eligible ? { eligible } : {}),
      path,
    });
  };
  // Each line points at its own list item, so deleting one line removes only that one.
  const at = (base: (string | number)[], v: unknown, i: number) => [...base, ...(Array.isArray(v) ? [i] : [])];
  const tagged = (t: string[] | undefined) => (t?.length ? { tags: t } : {});

  for (const [id, c] of m.catalogs)
    groups.push({ id: `catalog:${id}`, label: c.label ?? id, caption: m.word('Catalog'), icon: 'layout-grid', tone: 'violet', border: 'dashed', path: ['catalogs', id] });

  // Resources with children become groups, so a role on a subscription visibly covers what is in it.
  const parents = new Set(m.resources.map(([, r]) => r.in).filter(Boolean));
  for (const [id, r] of m.resources) {
    const k = resourceKinds[r.kind ?? ''];
    if (parents.has(id))
      groups.push({ id, parent: r.in, label: r.label ?? id, caption: r.caption ?? k?.label, icon: k?.icon, tone: k?.tone ?? 'slate', border: 'solid', ...tagged(r.tags), path: ['resources', id] });
    else
      nodes.push({ id, parent: r.in, shape: { kind: 'card', label: r.label ?? id, caption: r.caption ?? k?.label, icon: k?.icon, tone: k?.tone ?? 'slate' }, ...tagged(r.tags), path: ['resources', id] });
  }
  for (const [id, c] of m.controls) {
    const k = policyKinds[c.kind ?? ''];
    nodes.push({ id, shape: { kind: 'card', label: c.label ?? id, caption: c.caption ?? controlCaption(m, c), icon: k?.icon, tone: k?.tone ?? 'rose' }, ...tagged(c.tags), path: ['policies', id] });
  }
  for (const [id, p] of m.principals) {
    const k = principalKinds[p.kind ?? ''];
    nodes.push({ id, shape: { kind: 'card', label: p.label ?? id, caption: p.caption ?? k?.label, icon: k?.icon, tone: k?.tone ?? 'slate' }, ...tagged(p.tags), path: ['principals', id] });
  }
  for (const [id, p] of m.packages)
    nodes.push({
      id,
      parent: p.catalog ? `catalog:${p.catalog}` : undefined,
      shape: { kind: 'card', label: p.label ?? id, caption: p.caption ?? m.word('Access package'), icon: 'package', tone: 'violet' },
      ...tagged(p.tags),
      path: ['packages', id],
    });

  for (const [id, p] of m.principals) {
    const base = ['principals', id];
    for (const [i, g] of list(p['member-of']).entries()) if (m.principal(g)) edge(id, g, 'member', undefined, at([...base, 'member-of'], p['member-of'], i));
    for (const [i, o] of list(p.owners).entries()) if (m.principal(o)) edge(o, id, 'owns', undefined, at([...base, 'owners'], p.owners, i));
    // The app registration is the definition; its service principal is the app in this tenant, and what holds roles.
    if (p.app && m.principal(p.app)?.kind === 'app-registration') {
      if (p.kind === 'federated-credential') edge(id, p.app, 'federated', undefined, [...base, 'app']);
      else edge(p.app, id, 'instance', undefined, [...base, 'app']);
    }
  }
  for (const [id, c] of m.controls) {
    const base = ['policies', id];
    const lines = [
      ['targets', 'applies'],
      ['excludes', 'excludes'],
      ['apps', 'covers'],
      ['locations', 'location'],
      ['requires', 'requires'],
    ] as const;
    for (const [key, style] of lines)
      for (const [i, t] of list(c[key]).entries())
        if (m.principal(t) || m.resource(t) || m.control(t)) edge(id, t, style, undefined, at([...base, key], c[key], i), c.tags);
  }
  for (const [id, p] of m.packages) {
    // Each policy is its own card between requestors and package: who approves, for how long.
    for (const [i, pol] of m.policies(p).entries()) {
      const label = pol.auto ? m.word('Assigned automatically') : list(pol.approval).length ? m.word('Approval: {names}', { names: m.approvers(pol.approval) }) : m.word('No approval');
      const caption = [pol.duration, pol.review && m.word('review {when}', { when: pol.review })].filter(Boolean).join(' · ') || m.word('Policy');
      const policyId = pol.id ?? `${id}:policy:${i}`;
      const path = at(['packages', id, 'policy'], p.policy, i);
      nodes.push({
        id: policyId,
        parent: p.catalog ? `catalog:${p.catalog}` : undefined,
        shape: { kind: 'card', label: label.charAt(0).toUpperCase() + label.slice(1), caption, icon: 'list-checks', tone: 'slate' },
        ...tagged(p.tags),
        path,
      });
      for (const [j, r] of list(pol.requestors).entries()) if (m.principal(r)) edge(r, policyId, 'request', undefined, at([...path, 'requestors'], pol.requestors, j));
      edge(policyId, id, 'request', undefined, path);
    }
    for (const [i, h] of (p.holders ?? []).entries()) if (m.principal(h)) edge(h, id, 'holds', undefined, ['packages', id, 'holders', i]);
    for (const [i, g] of m.grants(p).entries())
      if (m.principal(g.target) || m.resource(g.target)) edge(id, g.target, 'grant', m.principal(g.target) ? undefined : g.role, ['packages', id, 'grants', i]);
  }
  for (const a of m.assignments) {
    // On the line, PIM's settings in short: how long at most, and whether someone approves (who, the matrix and describe say).
    const pim = a.eligible ? [a.activation, list(a.approval).length && m.word('approval')].filter(Boolean).join(' · ') : '';
    const parts = a.eligible ? { role: m.label(a.role), ...(a.activation ? { activation: a.activation } : {}), ...(list(a.approval).length ? { approval: m.approvers(a.approval) } : {}) } : undefined;
    edge(a.principal, a.scope, a.eligible ? 'eligible' : 'role', pim ? `${m.label(a.role)} · ${pim}` : m.label(a.role), a.path, a.tags, parts);
  }

  const legend: LegendItem[] = (Object.keys(edgeStyles) as (keyof typeof edgeStyles)[])
    .filter((k) => used.has(k))
    .map((k) => {
      const s: { label: string; line: GraphEdge['line']; tone: Tone; pattern?: LinePattern } = edgeStyles[k];
      return { label: s.label, line: s.line, tone: s.tone, ...(s.pattern ? { pattern: s.pattern } : {}) };
    });
  return { title: m.src.title, subtitle: m.src.subtitle, direction: m.src.direction ?? 'right', groups, nodes, edges, legend };
}

/** A Conditional Access card's caption when none is written: its state, and what it blocks or asks for in words. */
function controlCaption(m: Model, c: Control): string {
  const k = policyKinds[c.kind ?? ''];
  if (c.kind && c.kind !== 'conditional-access') return k?.label ?? c.kind;
  const words = (v: string | string[] | undefined) => list(v).filter((x) => !m.principal(x) && !m.resource(x) && !m.control(x));
  const apps = words(c.apps);
  const needs = words(c.requires);
  const parts = [
    c.state === 'report-only' ? m.word('Report-only') : c.state === 'off' ? m.word('Off@state') : undefined,
    apps.length ? apps.join(', ') : undefined,
    c.block ? m.word('blocks access') : needs.length ? m.word('requires {names}', { names: needs.join(` ${m.word('and')} `) }) : undefined,
  ].filter(Boolean);
  const text = parts.join(' · ');
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : m.word(k?.label ?? 'Conditional Access policy');
}

// ---------------------------------------------------------------- matrix views

function matrixGraph(m: Model, shape: GraphNode['shape'], legend: LegendItem[]): Graph {
  return {
    title: m.src.title,
    subtitle: m.src.subtitle,
    direction: 'right',
    groups: [],
    nodes: [{ id: 'matrix', shape, path: [] }],
    edges: [],
    legend,
  };
}

/** The key of a matrix: filled and outlined, each only when a cell is drawn that way. */
const pillLegend = (cells: (MatrixCell | undefined)[][], direct: string, inherited: string, checks = false): LegendItem[] => [
  ...(cells.some((r) => r.some((c) => c && !c.inherited)) ? [{ label: direct, swatch: checks ? ('check' as const) : ('fill' as const), tone: 'indigo' as Tone }] : []),
  ...(cells.some((r) => r.some((c) => c?.inherited)) ? [{ label: inherited, swatch: checks ? ('check-outline' as const) : ('outline' as const), tone: 'indigo' as Tone }] : []),
];

/** Who the who × where matrix has a row for: not who only requests, and not what never holds a role itself (an app registration, a device). */
const NO_ROW = ['dynamic-group', 'connected-org', 'app-registration', 'federated-credential', 'device', 'paw'];
const inMatrix = (m: Model) => m.principals.filter(([, p]) => !NO_ROW.includes(p.kind ?? '')).map(([id]) => id);

/** Resources in tree order, so a scope sits right before what it contains. */
function scopesInOrder(m: Model): string[] {
  const columns: string[] = [];
  const add = (parent: string | undefined) => {
    for (const [id, r] of m.resources)
      if ((r.in ?? undefined) === parent && !columns.includes(id)) {
        columns.push(id);
        add(id);
      }
  };
  add(undefined);
  return columns;
}

const cellOf = (r: Reach, word: Word = english): MatrixCell => ({ text: r.text, inherited: !r.direct, note: reachNote(r, word), tone: r.tone });

/** Groups an access package hands out: being in one is somewhere to get to, as a role on a site is. */
const grantedGroups = (m: Model) => [...new Set(m.packages.flatMap(([, p]) => m.grants(p).map((g) => g.target)))].filter((t) => m.principal(t));

/** How a principal is in a group: itself, through another group, or through an access package it holds. */
function membership(m: Model, p: string, group: string): MatrixCell | undefined {
  const groups = m.memberships(p);
  const cell = (via?: string): MatrixCell => ({ text: m.word('Member'), inherited: !!via, ...(via ? { note: m.word('via {name}', { name: via }) } : {}), tone: 'indigo' });
  if (list(m.principal(p)?.['member-of']).includes(group)) return cell();
  if (groups.has(group)) return cell(m.label(groups.get(group)!));
  const pkg = m.packages.find(([, x]) => (x.holders ?? []).some((h) => h === p || groups.has(h)) && m.grants(x).some((g) => g.target === group));
  return pkg ? cell(pkg[1].label ?? m.word('access package')) : undefined;
}

/** Who × where: every effective role per cell, the strongest on the pill, and where it comes from. With an earlier state: what was gained and lost since. */
function accessView(m: Model, was?: Model): Graph {
  if (was) return compareView(was, m);
  // A group a package hands out is a column once someone is in it; it is a row as well only when it reaches something itself.
  const granted = grantedGroups(m);
  const rows = inMatrix(m).filter((id) => !granted.includes(id) || m.reach(id).size);
  const groups = granted.filter((g) => rows.some((p) => membership(m, p, g)));
  const scopes = scopesInOrder(m);
  const columns = [...groups, ...scopes];
  const cells = rows.map((p) => {
    const reach = m.reach(p);
    return columns.map((scope) => {
      if (groups.includes(scope)) return membership(m, p, scope);
      // What is assigned on this very scope goes on the pill, ahead of what is inherited from above it.
      const all = [...(reach.get(scope) ?? [])].sort((a, b) => +!!a.from - +!!b.from);
      const [best, ...others] = all;
      if (!best) return undefined;
      const cell = cellOf(best, m.word);
      if (!others.length) return cell;
      // Every other role there too, before where the pill's role comes from: a note too long to draw in
      // full loses the tail, never a role. Each says where it comes from when that is not the pill's way.
      // What it shares with the pill's way (the same group, the same scope above) is said once, after the pill.
      const parts = (r: Reach) => [r.via && m.word('via {name}', { name: r.via }), r.from && m.word('from {name}@scope', { name: r.from }), r.activation].filter((x): x is string => !!x);
      const own = new Set(parts(best));
      const name = (r: Reach) => {
        const label = r.role ? m.label(r.role) : r.text;
        const mine = parts(r);
        const left = mine.filter((x) => !own.has(x));
        if (!mine.length) return own.size ? `${label} (${m.word('assigned directly')})` : label;
        return left.length ? `${label} (${left.join(', ')})` : label;
      };
      // Held now, and more on activation: the cell says both.
      const pending = best.eligible ? [] : others.filter((r) => r.eligible);
      const also = others.filter((r) => !pending.includes(r));
      const more = [also.length && m.word('also {roles}', { roles: also.map(name).join(', ') }), pending.length && m.word('eligible for {roles}', { roles: pending.map(name).join(', ') })];
      return { ...cell, note: [...more, cell.note].filter(Boolean).join('; ') };
    });
  });
  return matrixGraph(
    m,
    { kind: 'matrix', corner: m.word('Who \\ where'), rows: rows.map((id) => principalHeader(m, id)), columns: columns.map((id) => (groups.includes(id) ? principalHeader(m, id) : resourceHeader(m, id))), cells },
    pillLegend(cells, 'Assigned directly', 'Through a group, access package or parent scope'),
  );
}

// ---------------------------------------------------------------- gained and lost

/** What one principal reaches on one scope, before and after. */
interface Delta {
  before: Reach[];
  after: Reach[];
  gained: Reach[];
  lost: Reach[];
}

interface Side {
  /** The id in the later state, or in the earlier one for what is gone. */
  id: string;
  /** The model that knows it: the later one unless it is gone. */
  of: Model;
  state: 'same' | 'added' | 'removed';
}

/**
 * Two states side by side. A principal or scope is the same one when its object-id (resource-id) is,
 * and otherwise when its id is: so a rename in the directory is not somebody leaving and somebody arriving.
 */
function compareModels(was: Model, now: Model): { rows: Side[]; columns: Side[]; delta(row: number, column: number): Delta | undefined } {
  const principalKey = (m: Model, id: string) => m.principal(id)?.['object-id']?.toLowerCase() ?? id;
  const resourceKey = (m: Model, id: string) => m.resource(id)?.['resource-id']?.toLowerCase() ?? id;
  const sides = (before: string[], after: string[], key: (m: Model, id: string) => string) => {
    const old = new Map(before.map((id) => [key(was, id), id]));
    const seen = new Set(after.map((id) => key(now, id)));
    return [
      ...after.map((id): Side & { key: string } => ({ id, of: now, state: old.has(key(now, id)) ? 'same' : 'added', key: key(now, id) })),
      ...before.filter((id) => !seen.has(key(was, id))).map((id): Side & { key: string } => ({ id, of: was, state: 'removed', key: key(was, id) })),
    ];
  };
  const rows = sides(inMatrix(was), inMatrix(now), principalKey);
  const columns = sides(scopesInOrder(was), scopesInOrder(now), resourceKey);
  const wasId = new Map(inMatrix(was).map((id) => [principalKey(was, id), id]));
  const nowId = new Map(inMatrix(now).map((id) => [principalKey(now, id), id]));
  const byKey = (m: Model, reach: Map<string, Reach[]> | undefined) => new Map([...(reach ?? [])].map(([scope, r]) => [resourceKey(m, scope), r]));
  const reached = rows.map((r) => ({
    before: wasId.has(r.key) ? byKey(was, was.reach(wasId.get(r.key)!)) : undefined,
    after: nowId.has(r.key) ? byKey(now, now.reach(nowId.get(r.key)!)) : undefined,
  }));
  return {
    rows,
    columns,
    delta(row, column) {
      const before = reached[row]!.before?.get(columns[column]!.key) ?? [];
      const after = reached[row]!.after?.get(columns[column]!.key) ?? [];
      if (!before.length && !after.length) return undefined;
      return { before, after, gained: after.filter((a) => !before.some((b) => b.text === a.text)), lost: before.filter((b) => !after.some((a) => a.text === b.text)) };
    },
  };
}

const header = (s: Side, principal: boolean): MatrixHeader => {
  const h = principal ? principalHeader(s.of, s.id) : resourceHeader(s.of, s.id);
  const state = s.of.word(s.state === 'added' ? 'New@access' : 'Gone@access');
  return s.state === 'same' ? h : { ...h, change: s.state, caption: `${state}${h.caption ? ` · ${h.caption}` : ''}` };
};

/** The who × where matrix of what changed: gained with a +, lost with a − and struck through, changed with a ~; the rest of those rows and columns quietly. */
function compareView(was: Model, now: Model): Graph {
  const c = compareModels(was, now);
  const word = now.word;
  const cell = (r: Reach) => cellOf(r, word);
  const cells = c.rows.map((_, i) =>
    c.columns.map((_, j): MatrixCell | undefined => {
      const d = c.delta(i, j);
      if (!d) return undefined;
      if (!d.gained.length && !d.lost.length) return cell(d.after[0]!);
      if (!d.before.length) return { ...cell(d.after[0]!), text: `+ ${d.after[0]!.text}`, tone: 'green', change: 'added' };
      if (!d.after.length) return { ...cell(d.before[0]!), text: `− ${d.before[0]!.text}`, tone: 'rose', change: 'removed' };
      // Still something there, but not what it was: the strongest role now, and what came or went.
      const top = d.after[0]!;
      const note = d.gained.includes(top) && d.lost.length === 1 ? word('was {role}', { role: d.lost[0]!.text }) : [...d.gained.filter((r) => r !== top).map((r) => `+ ${r.text}`), ...d.lost.map((r) => `− ${r.text}`)].join(', ');
      return { ...cell(top), text: `~ ${top.text}`, tone: 'amber', change: 'changed', note: note || reachNote(top, word) };
    }),
  );
  // Only the rows and columns something changed in: a tenant is large, a change is small.
  const rows = c.rows.map((_, i) => i).filter((i) => cells[i]!.some((x) => x?.change));
  const columns = c.columns.map((_, j) => j).filter((j) => cells.some((r) => r[j]?.change));
  const graph = matrixGraph(
    now,
    {
      kind: 'matrix',
      corner: word('Who \\ where'),
      compare: true,
      rows: rows.map((i) => header(c.rows[i]!, true)),
      columns: columns.map((j) => header(c.columns[j]!, false)),
      cells: rows.map((i) => columns.map((j) => cells[i]![j])),
    },
    [
      { label: word('+ gained'), swatch: 'fill', tone: 'green' },
      { label: word('− lost'), swatch: 'outline', tone: 'rose' },
      { label: word('~ changed'), swatch: 'fill', tone: 'amber' },
      { label: word('as it was'), swatch: 'outline', tone: 'slate', muted: true },
    ],
  );
  if (!rows.length) graph.nodes = [{ id: 'matrix', shape: { kind: 'card', label: word('No access gained or lost'), caption: word('Everyone reaches what they reached before'), icon: 'shield-check', tone: 'green' }, path: [] }];
  return graph;
}

export interface AccessChange {
  kind: 'gained' | 'lost' | 'changed';
  /** Ids in the later state; in the earlier one for a principal or scope that is gone. */
  principal: string;
  scope: string;
  /** The names they are shown with. */
  who: string;
  where: string;
  /** The role gained or lost; the new one for a change. */
  role: string;
  /** The role it was, for a change. */
  was?: string;
  /** Where it comes from: "via sg-developers", "via Developer access". */
  how?: string;
  /** Others who got or lost the same through this principal (a group): their names. */
  with?: string[];
  /** The whole change in plain words. */
  text: string;
}

const silent: BuildContext = { error() {}, warn() {} };

/**
 * What everyone gained and lost between two states, in plain words: effective access, so joining a
 * group that holds a role counts, and a role on a subscription is told once, not for everything in it.
 */
export function accessChanges(before: AccessSource, after: AccessSource): AccessChange[] {
  const was = new Model(before, silent);
  const now = new Model(after, silent);
  const c = compareModels(was, now);
  const out: AccessChange[] = [];
  for (const [i, row] of c.rows.entries())
    for (const [j, column] of c.columns.entries()) {
      const d = c.delta(i, j);
      // What comes from a scope above is told there.
      const gained = d?.gained.filter((r) => !r.from) ?? [];
      const lost = d?.lost.filter((r) => !r.from) ?? [];
      if (!gained.length && !lost.length) continue;
      const base = { principal: row.id, scope: column.id, who: row.of.label(row.id), where: column.of.label(column.id) };
      if (gained.length === 1 && lost.length === 1) out.push({ ...base, kind: 'changed', role: gained[0]!.text, was: lost[0]!.text, how: gained[0]!.via && `via ${gained[0]!.via}`, text: '' });
      else {
        for (const r of gained) out.push({ ...base, kind: 'gained', role: r.text, how: r.via && `via ${r.via}`, text: '' });
        for (const r of lost) out.push({ ...base, kind: 'lost', role: r.text, how: r.via && `via ${r.via}`, text: '' });
      }
    }
  // A group's change is told once, with who it carries along, not again for each member.
  const own = out.filter((x) => !x.how);
  const told = out.filter((x) => {
    const through = x.how && own.find((g) => `via ${g.who}` === x.how && g.scope === x.scope && g.kind === x.kind && g.role === x.role && g.was === x.was);
    if (through) (through.with ??= []).push(x.who);
    return !through;
  });
  for (const x of told) {
    const others = x.with?.length ? `, and with it ${x.with.slice(0, 3).join(', ')}${x.with.length > 3 ? ` and ${x.with.length - 3} more` : ''}` : '';
    const what = x.kind === 'changed' ? `changed from ${x.was} to ${x.role}` : `${x.kind} ${x.role}`;
    x.text = `${x.who} ${what} on ${x.where}${x.how ? ` (${x.how})` : ''}${others}`;
  }
  return told;
}

/** Every principal with what it reaches, scope by scope: for tools that ask "who can reach this" without drawing. */
export function effectiveAccess(source: AccessSource): { principal: string; scope: string; reach: Reach[] }[] {
  const m = new Model(source, silent);
  return inMatrix(m).flatMap((p) => [...m.reach(p)].map(([scope, reach]) => ({ principal: p, scope, reach })));
}

// ---------------------------------------------------------------- checks

const OWNER_LEVEL = /\b(owner|user access administrator|role based access control administrator|global administrator|privileged role administrator)\b/i;
const BROAD = ['tenant', 'management-group', 'subscription', 'organization'];
const GROUPS = ['group', 'role-assignable-group', 'm365-group', 'dynamic-group'];

/** Things worth a second look. Warnings only: the picture stays as it is. */
function check(m: Model, ctx: BuildContext) {
  for (const a of m.assignments) {
    const kind = m.principal(a.principal)?.kind;
    const what = `${m.label(a.role)} on ${m.label(a.scope)}`;
    if (kind === 'unknown') ctx.warn(a.path, `${what} is held by an identity that no longer exists (${m.label(a.principal)}): the assignment can go`);
    // A role held in part says nothing about which part: two of them need not be the same.
    if ((kind === 'user' || kind === 'guest') && !m.role(a.role)?.part) {
      const group = m.assignments.find((x) => x.role === a.role && x.scope === a.scope && x.eligible === a.eligible && GROUPS.includes(m.principal(x.principal)?.kind ?? ''));
      if (group) ctx.warn(a.path, `${m.label(a.principal)} is ${what} directly, where ${m.label(group.principal)} holds the same role: membership of the group would do`);
    }
  }
  for (const [id, p] of m.principals) {
    if (p.kind !== 'guest') continue;
    for (const [scope, reach] of m.reach(id)) {
      const scopeKind = m.resource(scope)?.kind ?? '';
      const top = reach.find((r) => !r.from && OWNER_LEVEL.test(r.text) && !(r.role && m.role(r.role)?.part));
      if (top && BROAD.includes(scopeKind))
        ctx.warn(['principals', id], `Guest ${m.label(id)} is ${top.text} on ${resourceKinds[scopeKind]!.label.toLowerCase()} ${m.label(scope)}${top.via ? ` (via ${top.via})` : ''}: an owner-level role on a broad scope for someone from outside`);
    }
  }
}

/** Access packages × what they grant. */
function packagesView(m: Model): Graph {
  const targets: string[] = [];
  for (const [, p] of m.packages) for (const g of m.grants(p)) if (!targets.includes(g.target)) targets.push(g.target);
  const header = (id: string) => (m.principal(id) ? principalHeader(m, id) : resourceHeader(m, id));
  const rows = m.packages.map(([id, p]): MatrixHeader => {
    const pol = m.policies(p)[0];
    const caption = [p.catalog && m.catalogs.find(([c]) => c === p.catalog)?.[1].label, pol?.duration].filter(Boolean).join(' · ');
    return { label: p.label ?? id, caption: caption || m.word('Access package'), icon: 'package', tone: 'violet' };
  });
  const cells = m.packages.map(([, p]) => targets.map((t) => m.grants(p).find((g) => g.target === t)).map((g) => (g ? { text: g.role === 'Member' ? m.word('Member') : g.role, tone: 'violet' as Tone } : undefined)));
  return matrixGraph(m, { kind: 'matrix', corner: m.word('Package \\ grants'), rows, columns: targets.map(header), cells }, []);
}

/** Roles × permissions, with inherited permissions outlined. */
function rolesView(m: Model): Graph {
  const perms: string[] = [];
  for (const [id] of m.roles) for (const p of m.permissions(id).keys()) if (!perms.includes(p)) perms.push(p);
  const rows = m.roles.map(([id, r]): MatrixHeader => ({
    label: r.label ?? id,
    caption: list(r.inherits).length ? m.word('includes {names}', { names: list(r.inherits).map(m.label).join(', ') }) : undefined,
    icon: 'shield-check',
    tone: r.tone ?? 'indigo',
  }));
  const cells = m.roles.map(([id, r]) => {
    const own = m.permissions(id);
    return perms.map((p) => (own.has(p) ? { check: true, inherited: !own.get(p), tone: r.tone ?? ('indigo' as Tone) } : undefined));
  });
  return matrixGraph(
    m,
    { kind: 'matrix', corner: m.word('Role \\ permission'), rows, columns: perms.map((p) => ({ label: p })), cells },
    pillLegend(cells, 'Granted by the role', 'Included from another role', true),
  );
}

// ---------------------------------------------------------------- type

function build(src: AccessSource, ctx: BuildContext): Graph {
  const m = new Model(src, ctx);
  check(m, ctx);
  switch (src.view ?? 'graph') {
    case 'access':
      return accessView(m, src.was ? new Model(src.was, { ...silent, word: m.word }) : undefined);
    case 'packages':
      return packagesView(m);
    case 'roles':
      return rolesView(m);
    default:
      return graphView(m);
  }
}

const strings = { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] };
const objectId = { type: 'string', description: 'The object id in the directory: an import recognises it by this, whatever it is called here' };
const tags = { type: 'array', items: { type: 'string' }, description: 'Free words that layers pick it by, e.g. [tier0]' };
const entry = (kinds: string[], extra: Record<string, object> = {}) => ({
  anyOf: [
    { enum: kinds },
    {
      type: 'object',
      properties: { kind: { enum: kinds }, label: { type: 'string' }, caption: { type: 'string' }, ...extra, tags },
      additionalProperties: false,
    },
  ],
});
const policy = {
  type: 'object',
  properties: {
    id: { type: 'string', pattern: idPattern, description: 'Its own id, for steps and focus (otherwise <package>:policy:<n>)' },
    requestors: { ...strings, description: 'Principals who may request the package' },
    approval: { ...strings, description: 'Approvers in order, e.g. [manager, sg-security]' },
    duration: { type: 'string', description: 'e.g. 180 days' },
    review: { type: 'string', description: 'Access review, e.g. quarterly' },
    auto: { type: 'boolean', description: 'Assigned automatically' },
  },
  additionalProperties: false,
};

const palette: PaletteItem[] = [
  ...Object.entries(principalKinds).map(([kind, k]) => ({ collection: 'principals', kind, ...k })),
  { collection: 'catalogs', kind: 'catalog', label: 'Catalog', icon: 'layout-grid', tone: 'violet' },
  { collection: 'packages', kind: 'package', label: 'Access package', icon: 'package', tone: 'violet' },
  ...Object.entries(resourceKinds).map(([kind, k]) => ({ collection: 'resources', kind, ...k })),
  { collection: 'roles', kind: 'role', label: 'Role', icon: 'shield-check', tone: 'indigo' },
  ...Object.entries(policyKinds).map(([kind, k]) => ({ collection: 'policies', kind, ...k })),
];

export const access: DiagramType<AccessSource> = {
  id: 'access',
  name: 'Roles, groups and access packages',
  description: 'Who can get access, through which package or group, with which role on what',
  icon: 'shield-user',
  tagline: 'Who gets access to what: groups, access packages and roles',
  useWhen: [
    'Which group or access package grants which role',
    'Answer “who can reach production?” as a matrix',
    'Review Entra ID governance: catalogs, packages, approvals',
    'Privileged access: PIM, admin tiers, Conditional Access and PAWs',
  ],
  notFor: [
    { text: 'Where the resources run', use: 'azure' },
    { text: 'GitHub teams and repository permissions', use: 'github' },
  ],
  keywords: [
    'access', 'permission', 'role', 'rbac', 'group', 'access package', 'entra', 'identity', 'iam', 'who has access', 'who can', 'privilege',
    'governance', 'catalog', 'principal', 'security group', 'matrix', 'least privilege', 'audit',
    'pim', 'conditional access', 'paw', 'app registration', 'service principal', 'workload identity',
  ],
  schema: {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: 'Cartography access diagram',
    type: 'object',
    required: ['type'],
    properties: {
      type: { const: 'access' },
      title: { type: 'string' },
      subtitle: { type: 'string' },
      direction: { enum: ['right', 'down'] },
      view: { enum: ['graph', 'access', 'packages', 'roles'], description: 'graph, who × where matrix, packages matrix, or roles × permissions' },
      principals: {
        type: 'object',
        propertyNames: { pattern: idPattern },
        additionalProperties: entry(Object.keys(principalKinds), {
          'member-of': strings,
          owners: { ...strings, description: 'Who owns it: a group’s or an app’s owners' },
          app: { type: 'string', description: 'A service principal’s or a federated credential’s app registration (a principal of kind app-registration)' },
          'object-id': objectId,
        }),
      },
      policies: {
        type: 'object',
        description: 'Conditional Access policies, and the authentication strengths, named locations and compliance policies they use',
        propertyNames: { pattern: idPattern },
        additionalProperties: entry(Object.keys(policyKinds), {
          targets: { ...strings, description: 'Who it applies to: users, groups, directory roles' },
          excludes: { ...strings, description: 'Who it leaves out, e.g. the break-glass accounts' },
          apps: { ...strings, description: 'The apps it covers: resource ids, or words such as All cloud apps' },
          locations: { ...strings, description: 'Named locations it checks (ids under policies)' },
          requires: { ...strings, description: 'What a sign-in needs: an authentication strength, a device or PAW, a compliance policy, or words such as MFA' },
          block: { type: 'boolean', description: 'Blocks access instead of granting it' },
          state: { enum: ['on', 'report-only', 'off'] },
        }),
      },
      catalogs: {
        type: 'object',
        propertyNames: { pattern: idPattern },
        additionalProperties: { anyOf: [{ type: 'string' }, { type: 'null' }, { type: 'object', properties: { label: { type: 'string' }, 'object-id': objectId }, additionalProperties: false }] },
      },
      packages: {
        type: 'object',
        propertyNames: { pattern: idPattern },
        additionalProperties: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            caption: { type: 'string' },
            catalog: { type: 'string' },
            grants: {
              type: 'array',
              description: 'Group ids, or { app: role } for app and site roles',
              items: { anyOf: [{ type: 'string' }, { type: 'object', additionalProperties: { type: 'string' }, minProperties: 1 }] },
            },
            policy: { anyOf: [policy, { type: 'array', items: policy }] },
            holders: { type: 'array', items: { type: 'string' } },
            'object-id': objectId,
            tags,
          },
          additionalProperties: false,
        },
      },
      resources: {
        type: 'object',
        propertyNames: { pattern: idPattern },
        additionalProperties: entry(Object.keys(resourceKinds), {
          in: { type: 'string' },
          'resource-id': { type: 'string', description: 'The id where it lives, e.g. an Azure resource id: an import recognises it by this' },
        }),
      },
      roles: {
        type: 'object',
        propertyNames: { pattern: idPattern },
        additionalProperties: {
          anyOf: [
            { type: 'null' },
            {
              type: 'object',
              properties: {
                label: { type: 'string' },
                inherits: strings,
                permissions: { type: 'array', items: { type: 'string' } },
                tone: { enum: tones },
                'role-id': { type: 'string', description: 'The role definition id, for imports' },
                part: { type: 'boolean', description: 'Held somewhere inside the scope, not on all of it' },
              },
              additionalProperties: false,
            },
          ],
        },
      },
      assignments: {
        type: 'array',
        items: {
          anyOf: [
            { type: 'string', pattern: ASSIGNMENT.source, description: '"who is role on scope", e.g. "sg-devs is contributor on rg-dev"' },
            {
              type: 'object',
              required: ['principal', 'role', 'scope'],
              properties: {
                principal: { type: 'string' },
                role: { type: 'string' },
                scope: { type: 'string' },
                eligible: { type: 'boolean', description: 'Eligible only: activated through Privileged Identity Management (PIM) when needed' },
                activation: { type: 'string', description: 'PIM: how long one activation lasts at most, e.g. 8 h' },
                approval: { ...strings, description: 'PIM: who approves an activation, principal ids or words, in order' },
                tags,
              },
              additionalProperties: false,
            },
          ],
        },
      },
      was: { type: 'object', description: 'An earlier state of this diagram (its principals, resources, roles, packages and assignments): the who × where matrix then shows what was gained and lost. Written by carto diff' },
    },
    additionalProperties: false,
  },
  palette,
  build,
  // A view with nothing to show is not offered: no packages, no packages table.
  views: (src, word = english) => {
    const any = (c: 'packages' | 'roles') => Object.keys(src[c] ?? {}).length > 0;
    return [
      { name: 'graph', title: word('Who gets what, as a graph') },
      { name: 'access', title: word('Who × where'), table: true },
      ...(any('packages') ? [{ name: 'packages', title: word('Packages × grants'), table: true }] : []),
      ...(any('roles') ? [{ name: 'roles', title: word('Roles × permissions'), table: true }] : []),
    ];
  },
  references(src) {
    const out: Reference[] = [];
    type Collection = 'principals' | 'resources' | 'roles' | 'catalogs' | 'packages' | 'policies';
    const has = (c: Collection, id: string) => !!src[c] && Object.hasOwn(src[c]!, id);
    // A value that is one id or a list of ids, each in the first of the collections that has it (words name none).
    const ids = (v: unknown, path: (string | number)[], ...collections: Collection[]) => {
      const where = (x: string) => collections.find((c) => has(c, x));
      if (typeof v === 'string') {
        // A single id: deleting what it names removes this field, not the list (policy) around it.
        const collection = where(v);
        if (collection) out.push({ path, id: v, start: 0, collection, onDelete: 'key' });
      } else if (Array.isArray(v))
        v.forEach((x, i) => {
          const collection = typeof x === 'string' ? where(x) : undefined;
          if (collection) out.push({ path: [...path, i], id: x, start: 0, collection });
        });
    };
    for (const [id, p] of Object.entries(src.principals ?? {}))
      if (p && typeof p === 'object') {
        ids(p['member-of'], ['principals', id, 'member-of'], 'principals');
        ids(p.owners, ['principals', id, 'owners'], 'principals');
        ids(p.app, ['principals', id, 'app'], 'principals');
      }
    for (const [id, c] of Object.entries(src.policies ?? {}))
      if (c && typeof c === 'object') {
        const base = ['policies', id];
        ids(c.targets, [...base, 'targets'], 'principals', 'resources');
        ids(c.excludes, [...base, 'excludes'], 'principals', 'resources');
        ids(c.apps, [...base, 'apps'], 'resources');
        ids(c.locations, [...base, 'locations'], 'policies');
        ids(c.requires, [...base, 'requires'], 'policies', 'principals');
      }
    for (const [id, r] of Object.entries(src.resources ?? {})) if (r && typeof r === 'object') ids(r.in, ['resources', id, 'in'], 'resources');
    for (const [id, r] of Object.entries(src.roles ?? {})) if (r) ids(r.inherits, ['roles', id, 'inherits'], 'roles');
    for (const [id, p] of Object.entries(src.packages ?? {})) {
      const base = ['packages', id];
      if (typeof p.catalog === 'string') out.push({ path: [...base, 'catalog'], id: p.catalog, start: 0, collection: 'catalogs' });
      ids(p.holders, [...base, 'holders'], 'principals');
      for (const [i, g] of (p.grants ?? []).entries()) {
        if (typeof g === 'string') {
          const collection = has('principals', g) ? 'principals' : has('resources', g) ? 'resources' : undefined;
          if (collection) out.push({ path: [...base, 'grants', i], id: g, start: 0, collection });
        }
        else if (g && typeof g === 'object') for (const k of Object.keys(g)) if (has('resources', k)) out.push({ path: [...base, 'grants', i], key: true, id: k, start: 0, collection: 'resources' });
      }
      const policies = Array.isArray(p.policy) ? p.policy.map((x, i) => [x, [...base, 'policy', i]] as const) : p.policy ? [[p.policy, [...base, 'policy']] as const] : [];
      for (const [pol, path] of policies) {
        ids(pol.requestors, [...path, 'requestors'], 'principals');
        ids(pol.approval, [...path, 'approval'], 'principals');
      }
    }
    for (const [i, a] of (src.assignments ?? []).entries()) {
      if (typeof a === 'string') {
        const m = new RegExp(ASSIGNMENT.source, 'd').exec(a);
        if (!m?.indices) continue;
        // Groups 1, 3 and 4: group 2 is the word eligible.
        ([['principals', 1], ['roles', 3], ['resources', 4]] as const).forEach(([c, g]) => out.push({ path: ['assignments', i], id: m[g]!, start: m.indices![g]![0], collection: c, onDelete: 'item' }));
      } else if (a) {
        out.push({ path: ['assignments', i, 'principal'], id: a.principal, start: 0, collection: 'principals', onDelete: 'item' });
        out.push({ path: ['assignments', i, 'role'], id: a.role, start: 0, collection: 'roles', onDelete: 'item' });
        out.push({ path: ['assignments', i, 'scope'], id: a.scope, start: 0, collection: 'resources', onDelete: 'item' });
        ids(a.approval, ['assignments', i, 'approval'], 'principals');
      }
    }
    return out;
  },
  connect(src, from, to) {
    if (from === to) return 'Pick another element to connect to';
    const is = (collection: 'principals' | 'packages' | 'resources' | 'policies', id: string) => !!src[collection] && id in src[collection]!;
    const kindOf = (collection: 'principals' | 'policies', id: string) => {
      const v = src[collection]?.[id];
      return typeof v === 'string' ? v : v?.kind;
    };
    if (is('policies', from)) {
      // A Conditional Access policy applies to people and covers apps; what it asks for (a device, a strength) it requires.
      if (is('policies', to)) return { path: ['policies', from, kindOf('policies', to) === 'named-location' ? 'locations' : 'requires'], value: to };
      if (is('principals', to)) return { path: ['policies', from, ['device', 'paw'].includes(kindOf('principals', to) ?? '') ? 'requires' : 'targets'], value: to };
      if (is('resources', to)) {
        const r = src.resources![to];
        return { path: ['policies', from, (typeof r === 'string' ? r : r?.kind) === 'directory-role' ? 'targets' : 'apps'], value: to };
      }
      return 'Connect a policy to who it applies to, an app it covers, or what it requires';
    }
    if (is('principals', from) && is('principals', to)) return { path: ['principals', from, 'member-of'], value: to };
    if (is('principals', from) && is('packages', to)) return { path: ['packages', to, 'holders'], value: from };
    if (is('packages', from) && is('principals', to)) return { path: ['packages', from, 'grants'], value: to };
    if (is('packages', from) && is('resources', to)) return { path: ['packages', from, 'grants'], value: { [to]: 'User' } };
    if (is('principals', from) && is('resources', to)) {
      const role = Object.keys(src.roles ?? {})[0];
      if (!role) return 'Add a role first: a person or group gets a role on a resource';
      return { path: ['assignments'], value: `${from} is ${role} on ${to}` };
    }
    return 'Connect a person or group to a group, package or resource, a package to what it grants, or a policy to who it applies to';
  },
  template: `type: access
title: Engineering access
subtitle: Entra ID access packages and Azure roles
view: graph   # graph, access, packages or roles

principals:
  engineers: { kind: dynamic-group, label: Engineering, caption: department = Engineering }
  partner: { kind: connected-org, label: Contoso partners }
  sg-dev: { kind: group, label: sg-developers }
  sg-ops: { kind: role-assignable-group, label: sg-platform-admins }
  alice: { kind: user, label: Alice }
  bob: { kind: guest, label: Bob (Contoso) }
  deploy: { kind: service-principal, label: GitHub deploy }

catalogs:
  eng: Engineering

packages:
  dev:
    catalog: eng
    label: Developer access
    grants: [sg-dev, github: User]
    policy: { requestors: [engineers, partner], approval: [manager], duration: 180 days, review: quarterly }
    holders: [alice, bob]
  ops:
    catalog: eng
    label: Platform admin
    grants: [sg-ops]
    policy: { requestors: [engineers], approval: [manager, sg-ops], duration: 30 days }

resources:
  prod: { kind: subscription, label: Production }
  rg-shop: { kind: resource-group, label: rg-shop, in: prod }
  test: { kind: subscription, label: Test }
  github: { kind: app, label: GitHub Enterprise }

roles:
  reader: { label: Reader, permissions: [read] }
  contributor: { label: Contributor, inherits: reader, permissions: [write, deploy] }
  owner: { label: Owner, inherits: contributor, permissions: [manage access] }

assignments:
  - sg-dev is contributor on test
  - sg-dev is reader on prod
  - sg-ops is owner on prod
  - deploy is contributor on rg-shop
`,
};
