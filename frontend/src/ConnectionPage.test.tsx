import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ConnectionPage } from './pages/ConnectionPage';

const initial = {url:'',workspace:'primary',allowInsecureHttp:false,hasCredentials:false,
  status:'NON CONNECTÉ',serverVersion:null,lastTestedAt:null,lastSyncedAt:null};
afterEach(() => { cleanup();vi.unstubAllGlobals(); });

describe('connexion Survey Solutions HTTP', () => {
  it('affiche le risque HTTP et demande un accord avant de tester le workspace saisi', async () => {
    vi.stubGlobal('fetch',vi.fn(async () => new Response(JSON.stringify(initial),{status:200,headers:{'content-type':'application/json'}})));
    render(<ConnectionPage/>);
    const url=await screen.findByPlaceholderText('https://mon-serveur.example.org');
    fireEvent.change(url,{target:{value:'http://hq.example.test'}});
    fireEvent.change(screen.getByDisplayValue('primary'),{target:{value:'sankurusaco'}});
    const button=screen.getByRole('button',{name:/Tester la connexion Survey Solutions/});
    expect(screen.getByText('Serveur HTTP sans chiffrement')).toBeInTheDocument();
    expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox',{name:/J’autorise explicitement/}));
    expect(button).toBeEnabled();
    expect(screen.getByDisplayValue('sankurusaco')).toBeInTheDocument();
    fireEvent.change(url,{target:{value:'https://hq.example.test'}});
    expect(screen.queryByText('Serveur HTTP sans chiffrement')).not.toBeInTheDocument();
    expect(button).toBeEnabled();
  });

  it('montre le refus d’accès au workspace sans le présenter comme un mot de passe incorrect', async () => {
    const calls:unknown[]=[];
    vi.stubGlobal('fetch',vi.fn(async (path:string,options?:RequestInit) => {
      if (path.endsWith('/settings/survey-solutions') && !options?.method)
        return new Response(JSON.stringify(initial),{status:200,headers:{'content-type':'application/json'}});
      calls.push(JSON.parse(String(options?.body)));
      return new Response(JSON.stringify({error:'ACCÈS_WORKSPACE',message:'HTTP 403 : accès refusé à l’espace sankurusaco.'}),
        {status:502,headers:{'content-type':'application/json'}});
    }));
    render(<ConnectionPage/>);
    fireEvent.change(await screen.findByPlaceholderText('https://mon-serveur.example.org'),{target:{value:'http://hq.example.test'}});
    fireEvent.change(screen.getByDisplayValue('primary'),{target:{value:'sankurusaco'}});
    fireEvent.click(screen.getByRole('checkbox',{name:/J’autorise explicitement/}));
    fireEvent.click(screen.getByRole('button',{name:/Tester la connexion Survey Solutions/}));
    expect(await screen.findByText(/HTTP 403 : accès refusé/)).toBeInTheDocument();
    await waitFor(() => expect(calls).toContainEqual(expect.objectContaining({workspace:'sankurusaco',allowInsecureHttp:true})));
  });
});
