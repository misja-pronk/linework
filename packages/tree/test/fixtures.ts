// Big inputs for the tree engine's tests: a capability map of about 300 and an org of about 150, as
// YAML (for the engine) and as plain trees (for the layouts alone). Seeded, so every run is the same.

/** A small seeded generator. */
export function rng(seed: number) {
  let h = seed >>> 0;
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const AREAS = ['Strategy', 'Customer', 'Products', 'Sales', 'Operations', 'Supply chain', 'Finance', 'People', 'Risk', 'Technology'];
const WORDS = ['Planning', 'Management', 'Analytics', 'Onboarding', 'Pricing', 'Billing', 'Reporting', 'Forecasting', 'Service', 'Design', 'Sourcing', 'Compliance', 'Monitoring', 'Settlement', 'Engagement'];

/** A capability map: 10 areas, 6 or 7 capabilities each, 3 to 5 chips in most: about 300 in all. */
export function bigMap(seed = 7): string {
  const r = rng(seed);
  let out = 'type: capabilities\ntitle: Group capability map\nsubtitle: About 300 capabilities in three levels\nheat: maturity\ncapabilities:\n';
  let n = 0;
  for (const [a, area] of AREAS.entries()) {
    out += `  ${area}:\n`;
    n++;
    const caps = 6 + Math.floor(r() * 2);
    for (let c = 0; c < caps; c++) {
      const name = `${WORDS[(a * 3 + c) % WORDS.length]} ${a + 1}.${c + 1}`;
      const kids = r() < 0.2 ? 0 : 3 + Math.floor(r() * 3);
      n++;
      if (!kids) {
        out += `    - ${name}: { maturity: ${1 + Math.floor(r() * 5)} }\n`;
        continue;
      }
      out += `    - ${name}:\n        maturity: ${1 + Math.floor(r() * 5)}\n        capabilities:\n`;
      for (let k = 0; k < kids; k++, n++) out += `          - ${WORDS[(a + c + k * 5) % WORDS.length]} ${a + 1}.${c + 1}.${k + 1}: { maturity: ${1 + Math.floor(r() * 5)} }\n`;
    }
  }
  return out.replace('About 300', `${n}`);
}

const FIRST = ['Anna', 'Bo', 'Cem', 'Dana', 'Eli', 'Fay', 'Gus', 'Hana', 'Ivo', 'Jade', 'Kai', 'Lotte', 'Mila', 'Noor', 'Omar', 'Pim', 'Roos', 'Sven', 'Tess', 'Umar'];
const LAST = ['de Vries', 'Jansen', 'Yilmaz', 'Smit', 'Bakker', 'Visser', 'Peeters', 'Sato', 'de Boer', 'Lin', 'Vermeer', 'Willems', 'Kok', 'El Amrani', 'Patel', 'Bos', 'Mulder', 'Kramer', 'Jacobs', 'Hoekstra'];

/** An org of about 150: a CEO, 6 directors, 3 or 4 managers each, 4 to 9 people per manager. */
export function bigOrg(seed = 11): string {
  const r = rng(seed);
  const lines: string[] = [];
  let k = 0;
  const name = () => `${FIRST[k % FIRST.length]} ${LAST[Math.floor(k / FIRST.length + k * 7) % LAST.length]}`;
  const add = (id: string, role: string, reports?: string, extra = '') => {
    lines.push(`  ${id}: { name: ${name()}, role: ${role}${reports ? `, reports: ${reports}` : ''}${extra} }`);
    k++;
  };
  add('ceo', 'Chief executive');
  const depts = ['Product', 'Engineering', 'Sales', 'Marketing', 'Operations', 'Finance'];
  for (const [d, dept] of depts.entries()) {
    const dir = `d${d}`;
    add(dir, `Director of ${dept}`, 'ceo');
    const managers = 3 + Math.floor(r() * 2);
    for (let m = 0; m < managers; m++) {
      const mgr = `${dir}m${m}`;
      add(mgr, `${dept} manager`, dir);
      const people = 4 + Math.floor(r() * 6);
      for (let p = 0; p < people; p++) {
        const vacant = r() < 0.05;
        if (vacant) lines.push(`  ${mgr}p${p}: { role: ${dept} specialist, reports: ${mgr}, vacant: true }`);
        else add(`${mgr}p${p}`, `${dept} specialist`, mgr);
      }
    }
  }
  lines.push(`  d1m0p0x: { name: Wim Dekker, role: Staff engineer, reports: d1, dotted: d0 }`);
  return `type: teams\ntitle: Company org chart\nsubtitle: ${lines.length} people\npeople:\n${lines.join('\n')}\n`;
}
