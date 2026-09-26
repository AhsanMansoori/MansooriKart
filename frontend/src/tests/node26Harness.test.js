import React from 'react';
import { render, screen } from '@testing-library/react';
import { Button } from '@mui/material';

test('plain Jest arithmetic', () => expect(1 + 1).toBe(2));
test('minimal React render', () => {
  render(<div>Node 26 React</div>);
  expect(screen.getByText('Node 26 React')).toBeInTheDocument();
});
test('minimal MUI render', () => {
  render(<Button>Node 26 MUI</Button>);
  expect(screen.getByRole('button', { name: 'Node 26 MUI' })).toBeInTheDocument();
});
