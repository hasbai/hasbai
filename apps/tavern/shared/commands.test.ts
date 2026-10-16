import {it,expect} from 'vitest';
import {directCommand,splitOoc,userPrompt} from './commands';
it('recognizes exact standalone commands without swallowing ordinary dialogue',()=>{expect(directCommand(' /compress \n')).toBe('compress');expect(directCommand('/status')).toBe('status');expect(directCommand('他说 /status')).toBeNull();expect(directCommand('/compress 然后走')).toBeNull();});
it('keeps OOC separate from dialogue including multiple instruction lines',()=>{expect(splitOoc('/ooc 慢一点\n他说：「你好。」\n/ooc 不跳时')).toEqual({ooc:'慢一点\n不跳时',dialogue:'他说：「你好。」'});expect(userPrompt('普通消息')).toBe('普通消息');expect(splitOoc('故事中的 /ooc 不当命令').dialogue).toBe('故事中的 /ooc 不当命令');});
