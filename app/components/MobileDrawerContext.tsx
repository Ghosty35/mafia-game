'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';

type MobileDrawerContextType = {
  open: boolean;
  setOpen: (v: boolean) => void;
  rightOpen: boolean;
  setRightOpen: (v: boolean) => void;
};

const MobileDrawerContext = createContext<MobileDrawerContextType>({
  open: false,
  setOpen: () => {},
  rightOpen: false,
  setRightOpen: () => {},
});

export function MobileDrawerProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  return (
    <MobileDrawerContext.Provider value={{ open, setOpen, rightOpen, setRightOpen }}>
      {children}
    </MobileDrawerContext.Provider>
  );
}

export function useMobileDrawer() {
  const ctx = useContext(MobileDrawerContext);
  if (!ctx) throw new Error('useMobileDrawer must be used within MobileDrawerProvider');
  return ctx;
}
