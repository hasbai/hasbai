import {expect,it} from 'vitest';
import {messageActivities} from './activity-order';
import type {AgentActivity} from './types';
const activity=(id:string,kind:AgentActivity['kind'],messageId:string|null='reply'):AgentActivity=>({id,kind,messageId,ordinal:2,title:id,status:'completed',createdAt:1});
it('preserves execution order around story, including compression during Director',()=>{
 const tool=activity('tool','tool'),compression=activity('before','compression'),director=activity('director','director'),after=activity('after','compression');
 expect(messageActivities([activity('other','tool','old'),tool,compression,director,after,activity('command','status',null)],'reply')).toEqual({before:[tool,compression],after:[director,after]});
 expect(messageActivities([tool,compression],'reply')).toEqual({before:[tool,compression],after:[]});
});
