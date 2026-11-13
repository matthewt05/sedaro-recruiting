# DATA STRUCTURE

import doctest
from bisect import bisect_right


class QRangeStore:
    """
    A Q-Range KV Store mapping left-inclusive, right-exclusive ranges [low, high) to values.
    Reading from the store returns the collection of values whose ranges contain the query.
    ```
    0  1  2  3  4  5  6  7  8  9
    [A      )[B)            [E)
    [C   )[D   )
           ^       ^        ^  ^
    ```
    >>> store = QRangeStore()
    >>> store[0, 3] = 'Record A'
    >>> store[3, 4] = 'Record B'
    >>> store[0, 2] = 'Record C'
    >>> store[2, 4] = 'Record D'
    >>> store[8, 9] = 'Record E'
    >>> store[2, 0] = 'Record F'
    Traceback (most recent call last):
    IndexError: Invalid Range.
    >>> store[2.1]
    ['Record A', 'Record D']
    >>> store[1]
    ['Record A', 'Record C']
    >>> store[8]
    ['Record E']
    >>> store[5]
    Traceback (most recent call last):
    IndexError: Not found.
    >>> store[9]
    Traceback (most recent call last):
    IndexError: Not found.
    """

    def __init__(self):
        self.store = []
        self._ranges_by_low = []
        self._prefix_max_high = []

    def __setitem__(self, rng, value):
        try:
            (low, high) = rng
        except (TypeError, ValueError):
            raise IndexError("Invalid Range: must provide a low and high value.")
        if not low < high:
            raise IndexError("Invalid Range.")

        ordinal = len(self.store)
        self.store.append((low, high, value))

        entry = (low, ordinal)
        if not self._ranges_by_low or low >= self._ranges_by_low[-1][0]:
            self._ranges_by_low.append(entry)
            previous_max = self._prefix_max_high[-1] if self._prefix_max_high else high
            self._prefix_max_high.append(max(previous_max, high))
            return

        index = bisect_right(self._ranges_by_low, entry)
        self._ranges_by_low.insert(index, entry)
        self._prefix_max_high.insert(index, high)
        running_max = self._prefix_max_high[index - 1] if index else high
        for prefix_index in range(index, len(self._ranges_by_low)):
            range_high = self.store[self._ranges_by_low[prefix_index][1]][1]
            running_max = max(running_max, range_high)
            self._prefix_max_high[prefix_index] = running_max

    def __getitem__(self, key):
        index = bisect_right(self._ranges_by_low, (key, len(self.store))) - 1
        matches = []
        while index >= 0:
            if self._prefix_max_high[index] <= key:
                break
            low, ordinal = self._ranges_by_low[index]
            high = self.store[ordinal][1]
            if low <= key < high:
                matches.append(ordinal)
            index -= 1

        if not matches:
            raise IndexError("Not found.")
        matches.sort()
        return [self.store[ordinal][2] for ordinal in matches]

    def __len__(self):
        return len(self.store)


doctest.testmod()
