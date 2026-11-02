import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

describe('UI Primitives', () => {
  describe('Badge', () => {
    it('renders text with correct variant styles', () => {
      const { rerender } = render(<Badge variant="allow">ALLOWED</Badge>);
      expect(screen.getByText('ALLOWED')).toBeDefined();

      rerender(<Badge variant="deny">DENIED</Badge>);
      expect(screen.getByText('DENIED')).toBeDefined();

      rerender(<Badge variant="pending">PENDING</Badge>);
      expect(screen.getByText('PENDING')).toBeDefined();
    });
  });

  describe('Button', () => {
    it('renders with variants and respects disabled / loading states', () => {
      const { rerender } = render(<Button variant="primary">Click Me</Button>);
      const btn = screen.getByRole('button', { name: 'Click Me' }) as HTMLButtonElement;
      expect(btn).toBeDefined();
      expect(btn.disabled).toBe(false);

      rerender(<Button variant="danger" disabled>Destructive</Button>);
      const disabledBtn = screen.getByRole('button', { name: 'Destructive' }) as HTMLButtonElement;
      expect(disabledBtn.disabled).toBe(true);

      rerender(<Button loading>Loading Action</Button>);
      const loadingBtn = screen.getByRole('button', { name: 'Loading Action' });
      expect(loadingBtn.getAttribute('aria-busy')).toBe('true');
    });
  });
});
