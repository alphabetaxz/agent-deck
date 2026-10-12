export const API_VERSION = 1;
export const MAX_MESSAGE_BYTES = 256 * 1024;
const text = (value, limit) => typeof value === 'string' && value.length <= limit;
const statuses = new Set(['idle', 'running', 'waiting', 'completed', 'error', 'unknown']);
export function validateManifest(m) {
  if (!m || !/^[a-z][a-z0-9.-]{1,63}$/.test(m.id) || !text(m.name, 100) || !text(m.version, 32)) throw new Error('Invalid plugin manifest');
  if (m.apiVersion !== API_VERSION) throw new Error('Unsupported plugin API version');
  if (!text(m.entrypoint, 200) || !Array.isArray(m.cardTypes) || !Array.isArray(m.permissions)) throw new Error('Invalid plugin capabilities');
  return m;
}
export function validateCards(cards, manifest) {
  if (!Array.isArray(cards) || cards.length > 100) throw new Error('Invalid cards');
  const ids = new Set();
  for (const c of cards) {
    if (!c || !text(c.id, 160) || !c.id || ids.has(c.id) || !text(c.title, 150)) throw new Error('Invalid card identity');
    ids.add(c.id);
    if (!manifest.cardTypes.includes(c.type) || !['status','list','metric','text'].includes(c.type)) throw new Error('Unsupported card type');
    if (!Number.isFinite(c.updatedAt) || c.updatedAt < 0) throw new Error('Invalid timestamp');
    if (c.subtitle != null && !text(c.subtitle, 500)) throw new Error('Invalid subtitle');
    if (c.type === 'status' && (!statuses.has(c.status) || !text(c.summary, 1000))) throw new Error('Invalid status card');
    if(c.usage!=null){
      const u=c.usage;if(!u||typeof u!=='object'||!Number.isFinite(u.updatedAt)||u.updatedAt<0||!Array.isArray(u.windows)||u.windows.length>4)throw new Error('Invalid usage');
      for(const key of ['sessionTokens','sessionCostUSD','contextPercent'])if(u[key]!=null&&(!Number.isFinite(u[key])||u[key]<0||(key==='contextPercent'&&u[key]>100)))throw new Error('Invalid usage counter');
      for(const w of u.windows)if(!w||typeof w.id!=='string'||!/^[a-z0-9_-]{1,40}$/.test(w.id)||!Number.isFinite(w.usedPercent)||w.usedPercent<0||w.usedPercent>100||!Number.isFinite(w.resetsAt)||w.resetsAt<0||(w.windowMinutes!=null&&(!Number.isFinite(w.windowMinutes)||w.windowMinutes<0)))throw new Error('Invalid usage window');
    }
    if (c.type === 'text' && !text(c.text, 2000)) throw new Error('Invalid text card');
    if (c.type === 'metric' && (!text(c.value,100) || !text(c.unit ?? '',50))) throw new Error('Invalid metric card');
    if (c.type === 'list') {
      if (!Array.isArray(c.items) || c.items.length > 500) throw new Error('Invalid list');
      const itemIds = new Set();
      for (const item of c.items) {
        if (!text(item.id,100) || itemIds.has(item.id) || !text(item.title,500) || typeof item.done !== 'boolean') throw new Error('Invalid list item');
        itemIds.add(item.id);
      }
    }
  }
  return cards;
}
