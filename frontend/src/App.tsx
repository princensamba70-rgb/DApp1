import { IntelligenceSettings } from './pages/IntelligenceSettings';
import { createContext, lazy, Suspense, useContext, useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { api, post } from './api';
import { Layout } from './Layout';
import { LoginPage } from './pages/LoginPage';
import { Loading } from './components';
import type { User } from './types';

// Charger les écrans seulement à la première visite (notamment les graphiques Recharts).
const DashboardPage = lazy(() => import('./pages/DashboardPage').then(module => ({default:module.DashboardPage})));
const QuestionnaireListPage = lazy(() => import('./pages/QuestionnairePages').then(module => ({default:module.QuestionnaireListPage})));
const QuestionnaireDetailPage = lazy(() => import('./pages/QuestionnairePages').then(module => ({default:module.QuestionnaireDetailPage})));
const QualityPage = lazy(() => import('./pages/ReportPages').then(module => ({default:module.QualityPage})));
const ReportPage = lazy(() => import('./pages/ReportPages').then(module => ({default:module.ReportPage})));
const UsersPage = lazy(() => import('./pages/UsersPage').then(module => ({default:module.UsersPage})));
const ConnectionPage = lazy(() => import('./pages/ConnectionPage').then(module => ({default:module.ConnectionPage})));
const RulesPage = lazy(() => import('./pages/RulesPage').then(module => ({default:module.RulesPage})));
const ActivityPage = lazy(() => import('./pages/MorePages').then(module => ({default:module.ActivityPage})));
const ProfilePage = lazy(() => import('./pages/MorePages').then(module => ({default:module.ProfilePage})));

type Auth = {user:User|null;login:(username:string,password:string)=>Promise<void>;logout:()=>Promise<void>;setUser:(user:User|null)=>void};
const AuthContext=createContext<Auth|null>(null);
export function useAuth() {const value=useContext(AuthContext);if(!value)throw new Error('Auth manquante');return value;}
function AuthGate({admin=false,children}:{admin?:boolean;children:React.ReactNode}) {
  const {user}=useAuth();
  if(!user)return <Navigate to="/login" replace/>;
  if(admin&&user.role!=='admin')return <Navigate to="/" replace/>;
  return <>{children}</>;
}
export function App() {
  const [user,setUser]=useState<User|null|undefined>(undefined);
  useEffect(()=>{
    let active=true;
    api<{user:User}>('/auth/me').then(data=>{if(active)setUser(data.user);}).catch(()=>{if(active)setUser(null);});
    const expired=()=>setUser(null);
    window.addEventListener('sq-session-expired',expired);
    return ()=>{active=false;window.removeEventListener('sq-session-expired',expired);};
  },[]);
  async function login(username:string,password:string) {const data=await post<{user:User}>('/auth/login',{username,password});setUser(data.user);}
  async function logout() {try {await post('/auth/logout');} finally {setUser(null);} }
  if(user===undefined)return <div className="app-boot"><div className="brand-mark large"><span/><span/><span/></div><Loading label="Ouverture de votre espace…"/></div>;
  return <AuthContext.Provider value={{user,login,logout,setUser}}><Suspense fallback={<div className="app-boot"><Loading label="Chargement de la page…"/></div>}><Routes>
    <Route path="/login" element={user?<Navigate to="/" replace/>:<LoginPage/>}/>
    <Route element={<AuthGate><Layout/></AuthGate>}>
      <Route path="/" element={<DashboardPage/>}/>
      <Route path="/questionnaires" element={<QuestionnaireListPage/>}/>
      <Route path="/questionnaires/:id" element={<QuestionnaireDetailPage/>}/>
      <Route path="/quality" element={<QualityPage/>}/>
      <Route path="/reports" element={<ReportPage/>}/>
      <Route path="/activity" element={<ActivityPage/>}/>
      <Route path="/profile" element={<ProfilePage/>}/>
      <Route path="/users" element={<AuthGate admin><UsersPage/></AuthGate>}/>
      <Route path="/settings/connection" element={<AuthGate admin><ConnectionPage/></AuthGate>}/>
      <Route path="/settings/intelligence" element={<AuthGate admin><IntelligenceSettings/></AuthGate>}/>
      <Route path="/settings/rules" element={<AuthGate admin><RulesPage/></AuthGate>}/>
    </Route>
    <Route path="*" element={<Navigate to={user?'/':'/login'} replace/>}/>
  </Routes></Suspense></AuthContext.Provider>;
}
