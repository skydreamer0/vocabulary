import {requireChatGPTUser} from './chatgpt-auth';
import VocabularyApp from './vocabulary-app';
export const dynamic='force-dynamic';
export default async function Page(){const user=await requireChatGPTUser('/');return <VocabularyApp userKey={user.userId}/>}
