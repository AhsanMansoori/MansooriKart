import React from 'react';
import { Link } from 'react-router-dom';

function SearchResults({ results, onResultClick, setSearchResults }) {
  const select = () => {
    onResultClick();
    setSearchResults([]);
  };
  return (
    <ul className="max-h-80 overflow-y-auto">
      {results.map(product => {
        const id = product._id || product.id;
        return (
          <li key={id} className="border-b border-border last:border-0">
            <Link to={`/product/${id}`} onClick={select} className="flex gap-3 p-3 hover:bg-canvas">
              <img className="h-12 w-12 rounded object-cover" src={product.image} alt="" />
              <span>
                <span className="block font-semibold">{product.name}</span>
                <span className="text-sm text-muted">${Number(product.price || 0).toFixed(2)}</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export default SearchResults;
