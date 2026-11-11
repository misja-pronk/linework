// The questions moved to @cartography/core (the MCP server's prompt asks them too); here in the editor's language.
import { questionsFor as inEnglish, type DiagramType, type Question } from '@cartography/core';
import { say } from '../i18n/index.ts';

export type { Question };

export const questionsFor = (type: DiagramType): Question[] => inEnglish(type, (s) => say(s));
