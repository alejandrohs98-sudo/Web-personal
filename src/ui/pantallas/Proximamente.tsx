export function Proximamente({ fase, que }: { fase: number; que: string }) {
  return (
    <div className="vacio">
      <p>Aquí irá {que}.</p>
      <p className="pequeno">Llega en la fase {fase}.</p>
    </div>
  );
}
