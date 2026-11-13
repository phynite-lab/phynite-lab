'use client';
import { createContext, useContext, type ReactNode } from 'react';
import type { ViewportScope } from '@/lib/ai-viewport';
const Context = createContext<ViewportScope | null>(null);
export const useAiViewportScope = () => useContext(Context);
export function AiViewportScope({ value, children }: { value: ViewportScope; children: ReactNode }) { return <Context value={value}>{children}</Context>; }
