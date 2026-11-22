/** Resumen calculado de campañas existentes. Nunca modifica la base comercial. */
export function buildCampaignBoard(missions = [], threads = [], products = []) {
  const groups = new Map();
  const productsById = new Map(products.map(p => [p.id, p]));
  for (const mission of missions) {
    if (!mission || !mission.campaignId) continue;
    if (!groups.has(mission.campaignId)) {
      groups.set(mission.campaignId, {
        id: mission.campaignId, name: mission.campaignName || 'Campaña sin nombre',
        demo: Boolean(mission.demo), createdAt: mission.createdAt || null,
        total: 0, active: 0, queued: 0, completed: 0, warnings: 0,
        failed: 0, cancelled: 0, prospectsReported: 0,
        buyersRecorded: 0, replies: 0, draftsToReview: 0,
        acceptedQuotes: 0, products: [], progress: 0,
      });
    }
    const group = groups.get(mission.campaignId);
    group.total++;
    group.demo &&= Boolean(mission.demo);
    if (String(mission.createdAt || '') > String(group.createdAt || '')) group.createdAt = mission.createdAt;
    if (mission.status === 'queued') group.queued++;
    else if (mission.status === 'running') group.active++;
    else if (mission.status === 'done') group.completed++;
    else if (mission.status === 'done_with_warnings') group.warnings++;
    else if (mission.status === 'error') group.failed++;
    else if (mission.status === 'cancelled') group.cancelled++;
    group.prospectsReported += Math.max(0, Number(mission.stats?.prospects) || 0);
    group.products.push({ id: mission.productId, name: productsById.get(mission.productId)?.name || 'Lámpara no encontrada', missionId: mission.id, status: mission.status });
  }
  const missionGroups = new Map(missions.filter(m => m?.campaignId).map(m => [m.id, m.campaignId]));
  for (const thread of threads) {
    const group = groups.get(missionGroups.get(thread.missionId));
    if (!group || thread.demo) continue;
    group.buyersRecorded++;
    group.replies += (thread.messages || []).filter(m => m.direction === 'in').length;
    group.draftsToReview += (thread.drafts || []).filter(d => d.status === 'revisar').length;
    group.acceptedQuotes += (thread.quotes || []).filter(q => q.status === 'aceptada').length;
  }
  const board = [...groups.values()].sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  for (const group of board) group.progress = group.total ? Math.round((group.completed + group.warnings + group.failed + group.cancelled) / group.total * 100) : 0;
  return board;
}
