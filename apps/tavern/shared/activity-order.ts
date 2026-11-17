import type { AgentActivity } from './types';

/** Director and its subsequent compression belong after the finished story. */
export function messageActivities(activities: AgentActivity[], messageId: string) {
 const records = activities.filter(activity => activity.messageId === messageId);
 const director = records.findIndex(activity => activity.kind === 'director');
 return { before: director < 0 ? records : records.slice(0, director), after: director < 0 ? [] : records.slice(director) };
}
