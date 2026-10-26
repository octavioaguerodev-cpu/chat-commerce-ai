import { money, useData } from '../api.js';

export default function Products({ tick }) {
  const products = useData('/api/products', tick) ?? [];
  return (
    <section className="page">
      <h2>Productos</h2>
      <table>
        <thead>
          <tr>
            <th>SKU</th>
            <th>Producto</th>
            <th>Precio</th>
            <th>Stock</th>
          </tr>
        </thead>
        <tbody>
          {products.map((p) => (
            <tr key={p.id}>
              <td>
                <code>{p.sku}</code>
              </td>
              <td>{p.name}</td>
              <td>{money(p.price)}</td>
              <td className={p.stock === 0 ? 'out' : ''}>{p.stock}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
