import type { BotMatchScreenViewProps } from './botMatchScreenViewTypes.ts';
import { assembleBotMatchViewModel } from './view-model/assembleBotMatchViewModel.ts';

export type { CreateBotMatchViewModelArgs } from './view-model/createBotMatchViewModelArgs.ts';
export { assembleBotMatchViewModel } from './view-model/assembleBotMatchViewModel.ts';

export function createBotMatchViewModel(
  args: import('./view-model/createBotMatchViewModelArgs.ts').CreateBotMatchViewModelArgs,
): BotMatchScreenViewProps {
  return assembleBotMatchViewModel(args);
}