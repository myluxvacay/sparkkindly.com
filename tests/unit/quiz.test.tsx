import React from 'react';
import {describe,it,expect,vi,afterEach} from 'vitest';
import {render,screen,fireEvent,act} from '@testing-library/react';
import DailyQuiz,{QuizForm} from '../../components/Quiz';
import q from '../../content/quizzes/number-detective-001.json';
import other from '../../content/quizzes/word-clues-002.json';
import {quizSchema} from '../../lib/schemas';
const quiz=quizSchema.parse(q);const next=quizSchema.parse(other);
afterEach(()=>{vi.useRealTimers();});
describe('quiz interaction',()=>{
 it('reveals nothing on selection, reports correct and retries',()=>{render(<QuizForm quiz={quiz}/>);expect(screen.getByRole('button',{name:/Check answer/})).toBeDisabled();fireEvent.click(screen.getByRole('radio',{name:/30/}));expect(screen.queryByText(/Correct answer:/)).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:/Check answer/}));expect(screen.getByText(/That’s right/)).toBeInTheDocument();expect(screen.getByText(quiz.explanation)).toBeInTheDocument();expect(screen.getByRole('button',{name:/Check answer/})).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:/Try again/}));expect(screen.queryByText(quiz.explanation)).not.toBeInTheDocument();expect(screen.getByRole('button',{name:/Check answer/})).toBeDisabled();});
 it('explains an incorrect answer in text',()=>{render(<QuizForm quiz={quiz}/>);fireEvent.click(screen.getByRole('radio',{name:/24/}));fireEvent.click(screen.getByRole('button',{name:/Check answer/}));expect(screen.getByText('Correct answer: 30')).toBeInTheDocument();expect(screen.getByText(/A little discovery/)).toBeInTheDocument();});
 it('refreshes at midnight and on tab visibility with a frozen clock',async()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-17T23:59:59Z'));render(<DailyQuiz quizzes={[quiz,next]}/>);expect(screen.getByText(quiz.prompt)).toBeInTheDocument();await act(async()=>{vi.advanceTimersByTime(1100);});expect(screen.getByText(next.prompt)).toBeInTheDocument();vi.setSystemTime(new Date('2027-01-01T00:00:00Z'));act(()=>{fireEvent(document,new Event('visibilitychange'));});expect(screen.getByRole('heading',{name:'No new quiz today'})).toBeInTheDocument();});
});
