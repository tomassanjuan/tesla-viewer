// Legend: single source of truth for the colors/labels the graph, seek bar and map draw with. Drawing code reads COLOR
// (CSS custom-property names), the legend strip renders the same entries, so the two can't drift.
import { t } from './i18n.js';

export const COLOR = {
  speed: '--fg', ap: '--info', throttle: '--info', brake: '--accent', playhead: '--accent',
  played: '--accent', gap: '--warn', trim: '--warn', driven: '--route-driven', ahead: '--route-ahead', position: '--accent',
};

// kind selects the swatch shape (see .lg-* in style.css); color is a CSS var name or literal color.
export const LEGEND = [
  { id: 'graph', title: 'Graph', items: [
    { kind: 'line', color: COLOR.speed, label: 'Speed' },
    { kind: 'band', color: COLOR.ap, label: 'Autopilot' },
    { kind: 'bar', color: COLOR.throttle, label: 'Throttle' },
    { kind: 'bar', color: COLOR.brake, label: 'Brake' },
    { kind: 'line', color: COLOR.playhead, label: 'Playhead' },
  ] },
  { id: 'timeline', title: 'Timeline', items: [
    { kind: 'line', color: COLOR.played, label: 'Played' },
    { kind: 'hatch', color: COLOR.gap, label: 'Clip gap' },
    { kind: 'bar', color: COLOR.trim, label: 'Trim start / end' },
  ] },
  { id: 'map', title: 'Map', items: [
    { kind: 'line', color: COLOR.driven, label: 'Driven' },
    { kind: 'line', color: COLOR.ahead, label: 'Ahead' },
    { kind: 'dot', color: COLOR.position, label: 'Current position' },
  ] },
];

const cssColor = (c) => (c.startsWith('--') ? `var(${c})` : c);

/** Build the legend DOM (groups of swatch + label chips) into `root`, replacing its content. */
export function renderLegend(root, groups = LEGEND) {
  root.textContent = '';
  for (const g of groups) {
    const sec = document.createElement('div'); sec.className = 'lg-group'; sec.dataset.group = g.id;
    const h = document.createElement('b'); h.textContent = t(g.title); sec.append(h);
    for (const it of g.items) {
      const chip = document.createElement('span'); chip.className = 'lg-item';
      const sw = document.createElement('i'); sw.className = `lg-sw lg-${it.kind}`; sw.style.setProperty('--c', cssColor(it.color)); sw.setAttribute('aria-hidden', 'true');
      chip.append(sw, t(it.label)); sec.append(chip);
    }
    root.append(sec);
  }
  return root;
}
