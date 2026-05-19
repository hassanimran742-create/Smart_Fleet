import { useState } from 'react';
import { FillingOrdersScreen } from './FillingOrdersScreen';
import { DeliveryOrdersScreen } from './DeliveryOrdersScreen';

type Category = 'delivery' | 'filling';

export function OrdersScreen() {
  const [category, setCategory] = useState<Category>('delivery');

  return (
    <>
      <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ marginBottom: 0 }}>Orders</h2>
        <div className="flex" style={{ gap: 8 }}>
          <label style={{ margin: 0 }}>Category</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as Category)}
            style={{ width: 220 }}
          >
            <option value="delivery">Delivery orders</option>
            <option value="filling">Filling orders</option>
          </select>
        </div>
      </div>

      {category === 'delivery' ? <DeliveryOrdersScreen /> : <FillingOrdersScreen />}
    </>
  );
}
