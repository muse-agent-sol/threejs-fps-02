// The HUD: DOM over the canvas — vitals, money, ammo, timer, killfeed,
// banners, the buy menu, the scoreboard, and a canvas minimap.
//
// Everything the player needs at a glance lives here, updated through small
// setters the game calls when state changes (and a per-frame tick for the
// clock, the interact bar and the minimap). The buy menu and scoreboard are
// built from the same fighter data the game runs on, so what you see is the
// round as it actually stands.

import { BUY_MENU, WEAPONS } from './config.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.root = $('hud');
    this.health = $('health');
    this.armour = $('armour');
    this.hpFill = $('hp-fill');
    this.apFill = $('ap-fill');
    this.money = $('money');
    this.weaponName = $('weapon-name');
    this.ammoBox = $('ammo');
    this.ammoMag = $('ammo-mag');
    this.ammoReserve = $('ammo-reserve');
    this.timer = $('timer');
    this.phase = $('phase');
    this.scoreAtk = $('score-atk');
    this.scoreDef = $('score-def');
    this.siteBanner = $('site-banner');
    this.killfeed = $('killfeed');
    this.noticeEl = $('notice');
    this.banner = $('banner');
    this.bannerTitle = $('banner-title');
    this.bannerSub = $('banner-sub');
    this.interact = $('interact');
    this.interactLabel = $('interact-label');
    this.interactFill = $('interact-fill');
    this.hitmarker = $('hitmarker');
    this.vignette = $('vignette');
    this.buyOverlay = $('buy');
    this.buyGrid = $('buy-grid');
    this.buyMoney = $('buy-money');
    this.buyTimer = $('buy-timer');
    this.board = $('board');
    this.boardBody = $('board-body');
    this.minimap = $('minimap').getContext('2d');
    this.noticeUntil = 0;
    this.bannerUntil = 0;
    this.hitUntil = 0;
  }

  show() { this.root.hidden = false; }
  hide() { this.root.hidden = true; }

  setVitals(fighter) {
    this.health.textContent = String(Math.max(0, Math.ceil(fighter.health)));
    this.health.classList.toggle('low', fighter.health <= 30);
    this.armour.textContent = fighter.armor > 0 ? `🛡 ${Math.ceil(fighter.armor)}` : '';
    this.hpFill.style.width = `${Math.max(0, fighter.health)}%`;
    this.apFill.style.width = `${Math.max(0, fighter.armor)}%`;
    this.vignette.classList.toggle('low', fighter.alive && fighter.health <= 30);
  }

  setMoney(amount, delta = 0) {
    const deltaText = delta !== 0 ? ` <small>${delta > 0 ? '+' : ''}$${delta}</small>` : '';
    this.money.innerHTML = `$${amount} <small>CASH</small>${deltaText}`;
  }

  setWeapon(weapon) {
    if (!weapon) return;
    this.weaponName.textContent = weapon.def.name.toUpperCase();
    this.ammoMag.textContent = weapon.def.mag === Infinity ? '—' : String(weapon.mag);
    this.ammoReserve.textContent = weapon.def.reserve === Infinity ? '' : `/ ${weapon.reserve}`;
    this.ammoBox.classList.toggle('empty', weapon.mag === 0);
  }

  setClock(seconds, phaseLabel, hot = false) {
    const s = Math.max(0, Math.ceil(seconds));
    this.timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    this.timer.classList.toggle('hot', hot);
    this.phase.textContent = phaseLabel;
  }

  setScores(atk, def) {
    this.scoreAtk.textContent = String(atk);
    this.scoreDef.textContent = String(def);
  }

  setSiteBanner(site) {
    this.siteBanner.hidden = site === null;
    if (site) this.siteBanner.textContent = `CHARGE PLANTED — SITE ${site}`;
  }

  notice(text, seconds = 2.4, now = 0) {
    this.noticeEl.textContent = text;
    this.noticeUntil = now + seconds;
  }

  showBanner(title, sub, teamClass, seconds, now) {
    this.bannerTitle.textContent = title;
    this.bannerSub.textContent = sub;
    this.banner.className = teamClass ?? '';
    this.banner.hidden = false;
    this.bannerUntil = now + seconds;
  }

  hideBanner() {
    this.banner.hidden = true;
  }

  hitmark(kill, now) {
    this.hitmarker.classList.add('on');
    this.hitmarker.classList.toggle('kill', kill);
    this.hitUntil = now + (kill ? 0.3 : 0.14);
  }

  kill(entry, sticky = false) {
    const el = document.createElement('div');
    el.className = 'kill';
    const killerClass = entry.killerTeam === 'atk' ? 'atk' : 'def';
    const victimClass = entry.victimTeam === 'atk' ? 'atk' : 'def';
    el.innerHTML = `<span class="${killerClass}">${entry.killer}</span><span class="wpn">${entry.weapon}${entry.headshot ? ' <span class="hs">⌖</span>' : ''}</span><span class="${victimClass}">${entry.victim}</span>`;
    this.killfeed.appendChild(el);
    while (this.killfeed.children.length > 5) this.killfeed.firstChild.remove();
    if (!sticky) setTimeout(() => el.remove(), 5200);
  }

  setInteract(label, progress) {
    if (label === null) {
      this.interact.hidden = true;
      return;
    }
    this.interact.hidden = false;
    this.interactLabel.textContent = label;
    this.interactFill.style.width = `${Math.round(progress * 100)}%`;
  }

  // --- buy menu ---------------------------------------------------------------

  renderBuy(fighter, secondsLeft, onBuy) {
    this.buyMoney.textContent = `$${fighter.money}`;
    this.buyTimer.textContent = `0:${String(Math.max(0, Math.ceil(secondsLeft))).padStart(2, '0')}`;
    this.buyGrid.innerHTML = '';
    for (const item of BUY_MENU) {
      const button = document.createElement('button');
      button.className = 'buy-item';
      button.type = 'button';
      let name;
      let blurb;
      let price;
      let owned = false;
      if (item.kind === 'weapon') {
        const def = WEAPONS[item.id];
        name = def.name;
        blurb = def.blurb;
        price = def.price;
        owned = fighter.hasWeapon(item.id);
      } else if (item.kind === 'armor') {
        name = item.name;
        blurb = item.blurb;
        price = item.price;
        owned = fighter.armor >= 100 && (item.id === 'vest' || fighter.helmet);
      } else {
        name = item.name;
        blurb = item.blurb;
        price = item.price;
        owned = item.id === 'kit' ? fighter.kit : false;
        if (item.team && fighter.team !== item.team) continue;
      }
      const afford = fighter.money >= price;
      button.disabled = owned || !afford;
      button.innerHTML = `<span class="nm">${name}</span><span class="ds">${blurb}</span>` +
        (owned ? `<span class="owned">OWNED</span>` : `<span class="pr">$${price}</span>`);
      button.addEventListener('click', () => onBuy(item));
      this.buyGrid.appendChild(button);
    }
  }

  showBuy(visible) { this.buyOverlay.hidden = !visible; }
  buyVisible() { return !this.buyOverlay.hidden; }

  /** Clock and cash only — the grid itself re-renders on purchase, never per frame. */
  updateBuyClock(fighter, secondsLeft) {
    this.buyMoney.textContent = `$${fighter.money}`;
    this.buyTimer.textContent = `0:${String(Math.max(0, Math.ceil(secondsLeft))).padStart(2, '0')}`;
  }

  // --- scoreboard -----------------------------------------------------------------

  renderBoard(fighters, scores) {
    const rows = [];
    for (const team of ['atk', 'def']) {
      const label = team === 'atk' ? `VANGUARD — ${scores.atk}` : `HARBOR WATCH — ${scores.def}`;
      rows.push(`<tr class="team-head"><td colspan="6" style="color:var(--${team === 'atk' ? 'accent' : 'watch'})">${label}</td></tr>`);
      const members = fighters.filter((f) => f.team === team)
        .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
      for (const f of members) {
        rows.push(`<tr class="${f.alive ? '' : 'dead'} ${f.isPlayer ? 'me' : ''}"><td>${f.name}${f.isPlayer ? ' (you)' : ''}</td><td>${f.kills}</td><td>${f.deaths}</td><td>${f.assists}</td><td>$${f.money}</td><td>${f.isPlayer ? 12 : 24 + (f.id * 7) % 30}</td></tr>`);
      }
    }
    this.boardBody.innerHTML = rows.join('');
  }

  showBoard(visible) { this.board.hidden = !visible; }

  // --- minimap -----------------------------------------------------------------------

  drawMinimap(world, fighters, positionOf, playerYaw, plantedSite) {
    const g = this.minimap;
    const W = 184;
    const H = 140;
    const px = (x) => ((x + 50) / 100) * W;
    const pz = (z) => ((z + 38) / 76) * H;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(26,31,39,0.9)';
    g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(120,130,145,0.5)';
    for (const c of world.colliders) {
      g.fillRect(px(c.x1), pz(c.z1), Math.max(1.5, px(c.x2) - px(c.x1)), Math.max(1.5, pz(c.z2) - pz(c.z1)));
    }
    for (const site of Object.values(world.sites)) {
      g.strokeStyle = plantedSite === site.id ? '#e5484d' : '#f5a524';
      g.lineWidth = 1.4;
      g.beginPath();
      g.arc(px(site.x), pz(site.z), site.radius * (W / 100), 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = '#f5a524';
      g.font = 'bold 10px ui-monospace, monospace';
      g.fillText(site.id, px(site.x) - 3, pz(site.z) + 3);
    }
    for (const f of fighters) {
      if (!f.alive) continue;
      const p = positionOf(f);
      if (f.isPlayer) {
        g.save();
        g.translate(px(p.x), pz(p.z));
        g.rotate(-playerYaw);
        g.fillStyle = '#ece7db';
        g.beginPath();
        g.moveTo(0, -5);
        g.lineTo(3.6, 4);
        g.lineTo(-3.6, 4);
        g.closePath();
        g.fill();
        g.restore();
      } else if (f.team === 'atk') {
        g.fillStyle = '#f5a524';
        g.beginPath();
        g.arc(px(p.x), pz(p.z), 2.4, 0, Math.PI * 2);
        g.fill();
      }
    }
  }

  /** Per-frame housekeeping: expire the notice, banner and hitmarker. */
  tick(now) {
    if (this.noticeUntil > 0 && now > this.noticeUntil) {
      this.noticeEl.textContent = '';
      this.noticeUntil = 0;
    }
    if (this.bannerUntil > 0 && now > this.bannerUntil) {
      this.banner.hidden = true;
      this.bannerUntil = 0;
    }
    if (this.hitUntil > 0 && now > this.hitUntil) {
      this.hitmarker.classList.remove('on');
      this.hitUntil = 0;
    }
  }
}
