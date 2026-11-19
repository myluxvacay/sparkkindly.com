import { describe, expect, it } from 'vitest';
import {
  countInScene,
  describeChanges,
  describeScene,
  diffScenes,
  elementLabel,
  factValue,
  splitLabel,
  templateCollisions,
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

describe('template backdrop catalogue', () => {
  it('catalogues the backdrop objects that collide with fact vocabulary', () => {
    // The farm backdrop's big barn is a red house to any player; the street backdrop is three.
    expect(templateCollisions('farm', 'house')).toHaveLength(1);
    expect(templateCollisions('farm', 'house')[0].colors).toContain('red');
    expect(templateCollisions('street', 'house')[0].count).toBe(3);
    // The space backdrop is full of small white stars and stands on a planet, with a moon disc.
    expect(templateCollisions('space', 'star')[0].count).toBe('many');
    expect(templateCollisions('space', 'planet')).toHaveLength(1);
    expect(templateCollisions('space', 'moon')).toHaveLength(1);
    // The garden backdrop draws pebbles in its soil rows, never flowers.
    expect(templateCollisions('garden', 'flower')).toHaveLength(0);
    expect(templateCollisions('pond', 'duck')).toHaveLength(0);
  });
  it('splits labels into colour + noun', () => {
    expect(splitLabel('yellow house')).toEqual({ color: 'yellow', noun: 'house' });
    expect(splitLabel('bunch of grapes')).toEqual({ noun: 'bunch of grapes' });
    expect(splitLabel('green bunch of grapes')).toEqual({ color: 'green', noun: 'bunch of grapes' });
    expect(splitLabel('penguin')).toEqual({ noun: 'penguin' });
  });
});

describe('labels and descriptions', () => {
  it('derives colour-first labels and a scene description', () => {
    expect(elementLabel(pond.elements[0])).toBe('yellow duck');
    expect(describeScene(pond)).toContain('yellow duck');
    expect(describeScene({ template: 'station', clockTime: '4:30', elements: [] })).toContain('A clock shows 4:30.');
  });
});
