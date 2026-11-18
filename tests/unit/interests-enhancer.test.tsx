// Interests picker cap (user feedback, 17 Nov 2026): the counter is live and the maximum is enforced
// in the picker itself, not discovered after a refused save. Mounted in jsdom with real checkboxes:
// at the cap the unticked boxes are disabled (a further choice cannot be made), ticked boxes never
// are (one can always be unticked to free a place), and dropping below the cap reopens the rest.
import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import InterestsEnhancer from '@/components/me/InterestsEnhancer';

const Boxes = ({ n, picked = [] }: { n: number; picked?: number[] }) => (
  <form>
    {Array.from({ length: n }, (_, i) => (
      <label key={i}>
        <input type="checkbox" defaultChecked={picked.includes(i)} /> Choice {i + 1}
      </label>
    ))}
  </form>
);

describe('InterestsEnhancer', () => {
  it('shows the starting count and updates it as boxes are ticked and unticked', () => {
    const { container, getByLabelText } = render(
      <InterestsEnhancer max={3} initial={1}>
        <Boxes n={5} picked={[0]} />
      </InterestsEnhancer>,
    );
    const counter = () => container.querySelector('#interests-count')?.textContent ?? '';
    expect(counter()).toContain('1/3');
    fireEvent.click(getByLabelText(/Choice 2/));
    expect(counter()).toContain('2/3');
    fireEvent.click(getByLabelText(/Choice 1/));
    expect(counter()).toContain('1/3');
  });

  it('at the cap, unticked boxes are disabled and ticked ones stay live; below it, all reopen', () => {
    const { container, getByLabelText } = render(
      <InterestsEnhancer max={3} initial={0}>
        <Boxes n={5} />
      </InterestsEnhancer>,
    );
    fireEvent.click(getByLabelText(/Choice 1/));
    fireEvent.click(getByLabelText(/Choice 2/));
    fireEvent.click(getByLabelText(/Choice 3/));
    expect(container.querySelector('#interests-count')?.textContent).toContain('3/3');
    expect(container.querySelector('#interests-count')?.textContent).toMatch(/most you can choose/);
    const boxes = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
    expect(boxes.map((b) => b.disabled)).toEqual([false, false, false, true, true]);
    // A disabled box cannot be ticked: the count cannot pass the cap.
    fireEvent.click(boxes[3]);
    expect(container.querySelector('#interests-count')?.textContent).toContain('3/3');
    // Untick one and the closed boxes reopen.
    fireEvent.click(getByLabelText(/Choice 2/));
    expect(container.querySelector('#interests-count')?.textContent).toContain('2/3');
    expect(Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).map((b) => b.disabled)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it('a form that starts at the cap opens with the unticked boxes already closed', () => {
    const { container } = render(
      <InterestsEnhancer max={2} initial={2}>
        <Boxes n={4} picked={[0, 1]} />
      </InterestsEnhancer>,
    );
    const boxes = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
    expect(boxes.map((b) => b.disabled)).toEqual([false, false, true, true]);
  });
});
