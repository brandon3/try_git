import nback from './nback.js';
import matrix from './matrix.js';
import speed from './speed.js';
import stroop from './stroop.js';
import memory from './memory.js';
import verbal from './verbal.js';

/** The six trainable pillars, in the order they appear on the dashboard. */
export const GAMES = [nback, matrix, speed, stroop, memory, verbal];
export const gameById = Object.fromEntries(GAMES.map((g) => [g.id, g]));
