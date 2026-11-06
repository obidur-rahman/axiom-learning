'use client';

import { useEffect } from 'react';
import { installModelManager } from '../lib/model-manager';
import { installProviderFetch } from '../lib/provider-http';

/**
 * Installs the desktop HTTP transport and the local model-switch hook before
 * any AI call is made.
 */
export function ProviderHttpHost() {
  useEffect(() => {
    installModelManager();
    void installProviderFetch();
  }, []);
  return null;
}
