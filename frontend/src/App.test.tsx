import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { App } from './App';
import { Sidebar, navigationFor } from './Layout';
import type { User } from './types';

afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const admin:User={id:'1',username:'admin',role:'admin',active:true};
const user:User={id:'2',username:'user1',role:'user',active:true};

describe('navigation selon le rôle',()=>{
  it('ne rend aucun lien ni rubrique Paramètres pour un utilisateur',()=>{
    render(<MemoryRouter><Sidebar user={user} onLogout={()=>{}}/></MemoryRouter>);
    expect(screen.queryByRole('navigation',{name:'Paramètres'})).not.toBeInTheDocument();
    expect(screen.queryByText('Utilisateurs')).not.toBeInTheDocument();
    expect(screen.getByText('Contrôle qualité')).toBeInTheDocument();
    expect(screen.getByText('Rapports & analyses')).toBeInTheDocument();
    expect(navigationFor(user).admin).toHaveLength(0);
  });
  it('affiche les rubriques de configuration et utilisateurs à l’admin',()=>{
    render(<MemoryRouter><Sidebar user={admin} onLogout={()=>{}}/></MemoryRouter>);
    expect(screen.getByRole('navigation',{name:'Paramètres'})).toBeInTheDocument();
    expect(screen.getByText('Connexion Survey Solutions')).toBeInTheDocument();
    expect(screen.getByText('Utilisateurs')).toBeInTheDocument();
  });
});

describe('connexion',()=>{
  it('n’affiche aucun secret par défaut et masque la saisie du mot de passe',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({error:'NON_AUTHENTIFIÉ',message:'Authentification requise.'}),{status:401,headers:{'Content-Type':'application/json'}})));
    render(<MemoryRouter initialEntries={['/login']}><App/></MemoryRouter>);
    expect(await screen.findByRole('heading',{name:'Connexion'})).toBeInTheDocument();
    const field=screen.getByLabelText('Mot de passe');
    expect(field).toHaveAttribute('type','password');
    expect(field).toHaveValue('');
    expect(screen.getByLabelText('Nom d’utilisateur')).toHaveValue('');
  });
});
