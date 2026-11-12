// T065 of specs/004-sessions: what both roles' session screens share about a cancellation request
// (R-MOBILE-3): the «expired» display and the answer that reads the screen again after a refusal.
export {
  type AnswerCancellation,
  type CancellationView,
  cancellationShownExpired,
  useAnswerCancellation,
  useCancellationShownExpired,
} from './cancellation';
// T041: the request, its control and its words, and the panel each role's session screen places
// in its slot.
export {
  cancellationAnswerShown,
  cancellationRefusal,
  cancellationRequestShown,
  type RequestableSession,
  type RequestCancellation,
  type SettledRequestKey,
  settledRequestKey,
  useAnswerRequest,
  useCancellationRequestShown,
  useRequestCancellation,
} from './cancellation-request';
export { CancellationPanel } from './components/CancellationPanel';
export { participantReasonOf, reasonTooLong } from './reason';
// T042: the dispute's control, its raise and its words, and its panel; the reason form the
// student's complaint shares.
export { type ReasonFormWords, ReasonForm } from './components/ReasonForm';
export { DisputePanel } from './components/DisputePanel';
export { disputeRaiseShown, disputeRefusal, type RaiseDispute, useRaiseDispute } from './dispute';
