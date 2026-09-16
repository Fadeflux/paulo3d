/* =============================================================================
   Mode démo : jeu de données fictif, généré avec les mêmes règles que la base
   ============================================================================= */

function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const Demo = {
  async seed() {
    const b = Sync.backend;
    if (!b || b.kind !== 'demo') return;
    const rnd = seededRandom(20260916);
    const pickOne = (arr) => arr[Math.floor(rnd() * arr.length)];
    const now = Date.now();
    const at = (daysAgo, hour = 10) => {
      const d = new Date(now - daysAgo * DAY);
      d.setHours(hour, Math.floor(rnd() * 60), 0, 0);
      return d.toISOString();
    };
    const view = () => ({ ...cloneState(b.S), userId: b.userId, pending: new Set() });
    const send = (type, payload) => b.send({ type, payload });

    b.fast = true;
    try {
      await send('settings.save', { ...DEFAULT_SETTINGS });
      const p1s = uuid();
      const a1 = uuid();
      await send('machine.save', { id: p1s, name: 'Bambu Lab P1S', model: 'P1S + AMS', hourly_rate: 0.3, is_default: true, archived: false });
      await send('machine.save', { id: a1, name: 'Bambu Lab A1 mini', model: 'A1 mini', hourly_rate: 0.15, is_default: false, archived: false });

      const spool = async (brand, material, color_name, color_hex, price, daysAgo) => {
        const id = uuid();
        await send('spool.save', { id, brand, material, color_name, color_hex, price, initial_weight_g: 1000, tare_g: 250, purchased_at: new Date(now - daysAgo * DAY).toISOString().slice(0, 10), notes: null, archived: false });
        return id;
      };
      await spool('Bambu Lab', 'PLA', 'Noir', '#161616', 22, 160);
      await spool('Bambu Lab', 'PLA', 'Blanc', '#F2F2F2', 22, 160);
      await spool('Bambu Lab', 'PLA', 'Rouge', '#D32F2F', 22, 150);
      await spool('Bambu Lab', 'PLA Mat', 'Gris ardoise', '#5B6770', 24, 140);
      await spool('Bambu Lab', 'PETG', 'Noir', '#1C1C1C', 25, 60);
      await spool('Polymaker', 'PLA Silk', 'Or', '#C9A227', 26, 130);
      await spool('Bambu Lab', 'TPU', 'Noir', '#202020', 38, 120);
      await spool('eSun', 'PLA', 'Vert forêt', '#2E7D4F', 19, 110);

      const tpl = async (fields) => {
        const V = view();
        const materials = fields.materials.map(([material, color_hex, grams]) => {
          const line = { material, color_name: '', color_hex, grams, spool_id: null };
          const s = candidateSpools(V, line).find((c) => c.dist < 60);
          if (s) {
            line.spool_id = s.spool.id;
            line.color_name = s.spool.color_name;
          }
          return line;
        });
        const id = uuid();
        await send('template.save', {
          id, description: null, photo: null, pieces_per_print: 1, purge_g: 0, hardware_cost: 0, labor_min: 0,
          pricing_mode: null, price_coef: null, target_margin_pct: null, archived: false, ...fields, materials,
        });
        return id;
      };
      const T = {
        manette: await tpl({ name: 'Support manette universel', machine_id: p1s, materials: [['PLA', '#161616', 38], ['PLA', '#F2F2F2', 6]], purge_g: 4, hardware_cost: 0.15, print_time_min: 110, labor_min: 8, catalog_price: 12.9 }),
        porteCles: await tpl({ name: 'Porte-clés logo personnalisé', machine_id: p1s, pieces_per_print: 8, materials: [['PLA', '#D32F2F', 5], ['PLA', '#F2F2F2', 2]], purge_g: 3, hardware_cost: 0.35, print_time_min: 18, labor_min: 3, catalog_price: 4.9 }),
        vase: await tpl({ name: 'Vase spirale Ondine', machine_id: p1s, materials: [['PLA Silk', '#C9A227', 85]], print_time_min: 190, labor_min: 5, catalog_price: 24.9 }),
        organiseur: await tpl({ name: 'Organiseur de bureau modulaire', machine_id: p1s, materials: [['PLA Mat', '#5B6770', 145]], print_time_min: 320, labor_min: 12, catalog_price: 29 }),
        dragon: await tpl({ name: 'Dragon articulé', machine_id: a1, materials: [['PLA', '#2E7D4F', 62]], print_time_min: 240, labor_min: 15, catalog_price: 19.9 }),
        coque: await tpl({ name: 'Coque de protection Switch', machine_id: p1s, materials: [['TPU', '#202020', 34]], print_time_min: 95, labor_min: 6, catalog_price: 14.9 }),
      };

      const produce = async (templateId, quantity, daysAgo, kind = 'production', failedPct = 100) => {
        const V = view();
        const t = V.templates.get(templateId);
        const lines = t.materials;
        const gramsModel = sum(lines, (l) => l.grams);
        const spoolIds = lines.map((l) => {
          const need = (toNum(l.grams) + (gramsModel > 0 ? (toNum(t.purge_g) * toNum(l.grams)) / gramsModel : 0)) * quantity;
          const s = suggestSpool(V, l, need);
          return s ? s.id : null;
        });
        const { payload } = planProduction(V, { template: t, kind, quantity, failedPct, spoolIds, occurredAt: at(daysAgo, 9), reason: kind === 'failure' ? pickOne(FAILURE_REASONS.slice(0, 4)) : null });
        await send('production.launch', payload);
      };

      const plan = [
        [150, 'manette', 6], [148, 'porteCles', 16], [140, 'vase', 3], [132, 'dragon', 2], [125, 'organiseur', 1],
        [118, 'manette', 5], [110, 'coque', 5], [104, 'porteCles', 16], [96, 'vase', 3], [90, 'dragon', 2],
        [84, 'organiseur', 2], [76, 'manette', 6], [66, 'porteCles', 8], [58, 'coque', 5], [50, 'dragon', 2],
        [42, 'vase', 3], [35, 'organiseur', 1], [28, 'manette', 5], [20, 'dragon', 2], [12, 'porteCles', 8], [6, 'organiseur', 1],
      ];
      const failures = [[139, 'vase', 40], [95, 'manette', 60], [57, 'coque', 25], [19, 'dragon', 70]];
      const channels = ['direct', 'direct', 'etsy', 'etsy', 'vinted', 'leboncoin', 'salon'];
      const events = [
        ...plan.map(([d, k, q]) => ({ d, run: () => produce(T[k], q, d) })),
        ...failures.map(([d, k, pct]) => ({ d: d + 0.1, run: () => produce(T[k], 1, d, 'failure', pct) })),
      ];
      for (let d = 147; d >= 1; d -= 2 + Math.floor(rnd() * 4)) {
        events.push({
          d: d - 0.5,
          run: async () => {
            const V = view();
            const groups = stockGroups(V).filter((g) => g.qty > 0);
            if (!groups.length) return;
            const g = pickOne(groups);
            const t = g.template_id ? V.templates.get(g.template_id) : null;
            const qty = Math.min(g.qty, g.template_id === T.porteCles ? 2 + Math.floor(rnd() * 5) : 1 + (rnd() < 0.2 ? 1 : 0));
            const channel = pickOne(channels);
            const listPrice = t ? toNum(t.catalog_price) : 10;
            const unitPrice = roundDb(channel === 'salon' || channel === 'leboncoin' ? listPrice * (0.85 + rnd() * 0.1) : listPrice, 2);
            const shipped = channel === 'etsy' || channel === 'vinted';
            const form = {
              id: uuid(), channel, customer: null, note: null, occurred_at: at(d, 15),
              shipping_charged: channel === 'etsy' ? 4.9 : 0,
              shipping_cost: shipped && channel === 'etsy' ? 4.55 : 0,
              packaging_cost: shipped ? 0.6 : channel === 'direct' ? 0.2 : 0,
              platform_fee: channel === 'etsy' ? roundDb(qty * unitPrice * 0.1 + 0.3, 2) : 0,
              items: [{ id: uuid(), template_id: g.template_id, item_name: g.item_name, quantity: qty, unit_price: unitPrice, from_stock: true }],
            };
            const p = planSale(V, form);
            if (!p.shortages.length) await send('sale.record', p.payload);
          },
        });
      }
      events.push({
        d: 3,
        run: async () => {
          const V = view();
          const noir = activeSpools(V).find((s) => s.material === 'PLA' && s.color_name === 'Noir');
          if (noir) await send('spool.weigh', { id: uuid(), spool_id: noir.id, measured_g: Math.max(40, roundDb(toNum(noir.remaining_weight_g) - 18, 0)), occurred_at: at(3, 18), note: 'Pesée de contrôle' });
        },
      });
      events.push({
        d: 30,
        run: async () => {
          const V = view();
          const g = stockGroups(V).find((x) => x.template_id === T.vase && x.qty > 0);
          if (g) await send('stock.adjust', { id: uuid(), template_id: g.template_id, item_name: g.item_name, quantity: 1, reason: 'casse', note: 'Tombé de l’étagère', occurred_at: at(30, 17) });
        },
      });
      events.sort((x, y) => y.d - x.d);
      for (const ev of events) await ev.run();
    } finally {
      b.fast = false;
    }
    await Sync.kick(true);
    toast('Données d’exemple ajoutées', { tone: 'ok' });
  },

  async reset() {
    const b = Sync.backend;
    if (!b || b.kind !== 'demo') return;
    await b.reset();
    Store.S = emptyState();
    Store.Q = [];
    Store.meta = { lastPull: {}, lastReconcile: 0 };
    for (const t of TABLES) Store.dirty.add(t);
    await Store.persistQueue();
    await Store.persistSnapshotNow();
    Store.rebuild(true);
    await Sync.kick(true);
    toast('Démo vidée', { tone: 'ok' });
  },
};
