// Question-driven wizards: a few answers in, a correct and good-looking diagram out (docs/wizards.md).
import type { Wizard } from './engine.ts';
import { azureLandingZone } from './wizards/azure-landing-zone.ts';
import { aksBaseline } from './wizards/aks-baseline.ts';
import { hubSpoke } from './wizards/hub-spoke.ts';
import { awsLandingZone, awsThreeTier } from './wizards/aws.ts';
import { dataMesh } from './wizards/data-mesh.ts';
import { c4Starter } from './wizards/c4.ts';
import { gitStrategy, teamTopologies } from './wizards/team-flow.ts';

export * from './engine.ts';
export { translateWizard, wizardWords } from './lang.ts';

export const wizards: Wizard[] = [azureLandingZone, aksBaseline, hubSpoke, awsThreeTier, awsLandingZone, dataMesh, c4Starter, gitStrategy, teamTopologies];

export const findWizard = (id: string) => wizards.find((w) => w.id === id);

/** The wizards offered for a diagram type in the start dialog. */
export const wizardsFor = (type: string) => wizards.filter((w) => (w.types ?? [w.type]).includes(type));
