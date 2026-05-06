export { parseSSE } from './parseSSE';
export type { ParsedSSEEvent, SSEParseResult } from './parseSSE';
export {
  ChatCompletionError,
  streamChatCompletion,
} from './nanogptChat';
export type {
  ChatCompletionFailure,
  ChatCompletionMessage,
  ChatCompletionRequest,
  StreamEvent,
} from './nanogptChat';
export {
  HISTORY_SOFT_CAP,
  HISTORY_SOFT_CAP_OPEN,
  HISTORY_SOFT_CAP_PASSAGE,
  assembleOpenChatPrompt,
  assemblePassageChatPrompt,
  buildOpenModeSystemPrompt,
  buildPassageBlockForPreview,
} from './promptAssembly';
export type {
  AssembleOpenChatInput,
  AssemblePassageChatInput,
  AssembleOpenChatResult,
} from './promptAssembly';
export { makeChatRequestMachine } from './chatRequestMachine';
export type {
  ChatRequestContext,
  ChatRequestEvent,
  ChatRequestInput,
  FinalizeFields,
  MachineDeps,
} from './chatRequestMachine';
export { useChatThreads } from './useChatThreads';
export type { UseChatThreadsHandle, DraftState } from './useChatThreads';
export { useChatMessages } from './useChatMessages';
export type { UseChatMessagesHandle } from './useChatMessages';
export { useChatSend } from './useChatSend';
export type { SendState, UseChatSendHandle } from './useChatSend';
export { useSavedAnswers } from './useSavedAnswers';
export type { UseSavedAnswersHandle } from './useSavedAnswers';
