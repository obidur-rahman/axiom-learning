'use client';

import { useEffect } from 'react';
import { installProviderFetch } from '../lib/provider-http';

/** Installs the desktop HTTP transport before any AI call is made. */
export function ProviderHttpHost() {
  useEffect(() => {
    void installProviderFetch();
  }, []);
  return null;
}
