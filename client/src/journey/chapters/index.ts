export {
  CH1_FRITZ_TRAIL_CHAPTER_TITLE,
  CH1_FRITZ_TRAIL_NODES,
} from './ch1FritzTrail.nodes.ts';
export { CH2_HIGH_LINE_NODES } from './ch2HighLine.nodes.ts';
export { CH3_LONG_MARCH_NODES } from './ch3LongMarch.nodes.ts';
export { CH4_PRESSURE_CIRCUIT_NODES } from './ch4PressureCircuit.nodes.ts';
export { CH5_IRON_MILE_NODES } from './ch5IronMile.nodes.ts';
export { CH6_MASTER_TABLE_NODES } from './ch6MasterTable.nodes.ts';
export { CHAPTER_6_BRIEFINGS, CHAPTER_6_PUZZLES } from './ch6MasterTable.content.ts';

import { CH1_FRITZ_TRAIL_NODES } from './ch1FritzTrail.nodes.ts';
import { CH2_HIGH_LINE_NODES } from './ch2HighLine.nodes.ts';
import { CH3_LONG_MARCH_NODES } from './ch3LongMarch.nodes.ts';
import { CH4_PRESSURE_CIRCUIT_NODES } from './ch4PressureCircuit.nodes.ts';
import { CH5_IRON_MILE_NODES } from './ch5IronMile.nodes.ts';
import { CH6_MASTER_TABLE_NODES } from './ch6MasterTable.nodes.ts';
import { JOURNEY_CHAPTER_1_ID } from '../journeyTypes.ts';
import {
  JOURNEY_CHAPTER_2_ID,
  JOURNEY_CHAPTER_3_ID,
  JOURNEY_CHAPTER_4_ID,
  JOURNEY_CHAPTER_5_ID,
  JOURNEY_CHAPTER_6_ID,
} from '../journeyChapterIds.ts';

export const JOURNEY_CHAPTER_NODES_BY_ID = {
  [JOURNEY_CHAPTER_1_ID]: CH1_FRITZ_TRAIL_NODES,
  [JOURNEY_CHAPTER_2_ID]: CH2_HIGH_LINE_NODES,
  [JOURNEY_CHAPTER_3_ID]: CH3_LONG_MARCH_NODES,
  [JOURNEY_CHAPTER_4_ID]: CH4_PRESSURE_CIRCUIT_NODES,
  [JOURNEY_CHAPTER_5_ID]: CH5_IRON_MILE_NODES,
  [JOURNEY_CHAPTER_6_ID]: CH6_MASTER_TABLE_NODES,
} as const;

/** @deprecated Use CH1_FRITZ_TRAIL_NODES from the chapter module. */
export const JOURNEY_CHAPTER_1_NODES = CH1_FRITZ_TRAIL_NODES;
