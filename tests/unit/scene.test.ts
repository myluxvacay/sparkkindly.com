import { describe, expect, it } from 'vitest';
import {
  countInScene,
  describeChanges,
  describeScene,
  diffScenes,
  elementLabel,
  factValue,
  type SceneSpec,
} from '@/lib/games/scene';

const pond: SceneSpec = {
  template: 'pond',
  elements: [
    { id: 'duck-1', art: 'duck', name: 'duck', color: 'yellow', x: 200, y: 420 },
    { id: 'duck-2', art: 'duck', name: 'duck', color: 'yellow', x: 320, y: 440 },
    { id: 'duck-3', art: 'duck', name: 'duck', color: 'white', x: 460, y: 430 },
    { id: 'frog-1', art: 'frog', name: 'frog', color: 'green', x: 620, y: 470 },
  ],
};

describe('countInScene', () => {
  it('counts by art and by colour', () => {
    expect(countInScene(pond, { art: 'duck' })).toBe(3);
    expect(countInScene(pond, { art: 'duck', color: 'yellow' })).toBe(2);
    expect(countInScene(pond, { art: 'frog', color: 'yellow' })).toBe(0);
  });
});

describe('factValue', () => {
  it('reads clock, sign, colour, count, present and absent facts from the scene data', () => {
    const station: SceneSpec = { template: 'station', clockTime: '4:30', signText: 'Bakery', elements: pond.elements };
    expect(factValue(station, { type: 'clock' })).toBe('4:30');
    expect(factValue(station, { type: 'sign' })).toBe('Bakery');
    expect(factValue(pond, { type: 'color', elementId: 'duck-3' })).toBe('white');
    expect(factValue(pond, { type: 'count', art: 'duck' })).toBe('3');
    expect(factValue(pond, { type: 'present', elementId: 'frog-1' })).toBe('green frog');
    expect(factValue(pond, { type: 'absent', label: 'red kite' })).toBe('red kite');
  });
  it('refuses an absent fact for something that is present', () => {
    expect(factValue(pond, { type: 'absent', label: 'yellow duck' })).toBeNull();
  });
  it('refuses a clock fact when the scene has no clock', () => {
    expect(factValue(pond, { type: 'clock' })).toBeNull();
  });
});

describe('diffScenes', () => {
  it('finds added, removed, colour, moved and turned changes with canonical keys', () => {
    const after: SceneSpec = {
      template: 'pond',
      elements: [
        { id: 'duck-1', art: 'duck', name: 'duck', color: 'pink', x: 200, y: 420 },
        { id: 'duck-2', art: 'duck', name: 'duck', color: 'yellow', x: 420, y: 440 },
        { id: 'duck-3', art: 'duck', name: 'duck', color: 'white', x: 460, y: 430, flip: true },
        { id: 'kite-1', art: 'kite', name: 'kite', color: 'red', x: 600, y: 200 },
      ],
    };
    const changes = diffScenes(pond, after);
    expect(changes.map((c) => c.key).sort()).toEqual(
      ['duck-1:color:yellow->pink', 'duck-2:moved', 'duck-3:turned', 'frog-1:removed', 'kite-1:added'].sort(),
    );
    expect(describeChanges(changes)).toContain('changed colour from yellow to pink');
  });
  it('ignores sub-epsilon nudges', () => {
    const after: SceneSpec = {
      template: 'pond',
      elements: pond.elements.map((el) => ({ ...el, x: el.x + 2 })),
    };
    expect(diffScenes(pond, after)).toEqual([]);
  });
});

describe('labels and descriptions', () => {
  it('derives colour-first labels and a scene description', () => {
    expect(elementLabel(pond.elements[0])).toBe('yellow duck');
    expect(describeScene(pond)).toContain('yellow duck');
    expect(describeScene({ template: 'station', clockTime: '4:30', elements: [] })).toContain('A clock shows 4:30.');
  });
});
