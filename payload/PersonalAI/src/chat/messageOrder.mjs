/** Canonical source-of-truth message order, including delayed replies. */
export function orderConversationMessages(messages, replyLinks = new Map()) {
  const source = messages.map((message, index) => ({message, index}));
  const users = new Map(source.filter(x => x.message.role === 'user').map(x => [x.message.id, x]));
  const usersByCreatedAt = new Map();
  for (const entry of source) {
    if(entry.message.role!=='user'||entry.message.createdAt==null)continue;
    const list=usersByCreatedAt.get(entry.message.createdAt)??[];list.push(entry);usersByCreatedAt.set(entry.message.createdAt,list);
  }
  const key = ({message, index}) => {
    const replyTo = message.replyToId ?? replyLinks.get(message.id);
    // Older client-side failure replies predate replyToId/job records, but were
    // created with the triggering user's exact timestamp. Recover only this
    // unambiguous legacy relation; do not guess from nearby messages.
    const legacyParents=!replyTo&&message.role==='assistant'?usersByCreatedAt.get(message.createdAt):undefined;
    const legacyParent=legacyParents?.length===1&&legacyParents[0].index<index?legacyParents[0]:undefined;
    const parent = replyTo ? users.get(replyTo) : legacyParent;
    const anchor = parent?.index ?? index;
    const turn = parent ? 1 : 0;
    return [anchor, turn, message.createdAt ?? 0, index];
  };
  return source.sort((a,b) => {
    const x=key(a),y=key(b);
    for(let i=0;i<x.length;i++)if(x[i]!==y[i])return x[i]-y[i];
    return 0;
  }).map(x => x.message);
}
