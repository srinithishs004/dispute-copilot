import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NotFound } from './NotFound';

describe('NotFound', () => {
  it('says the page was not found and links home', () => {
    render(
      <MemoryRouter>
        <NotFound />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/not found/i);
    expect(screen.getByRole('link', { name: /home/i }).getAttribute('href')).toBe('/');
  });
});
