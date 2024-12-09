export function mergeObjects<T>(source: T, target: T): void {
    if (typeof source !== 'object' || source === null || typeof target !== 'object' || target === null) {
        return;
    }
  
    Object.keys(source).forEach(key => {
        const sourceValue = (source as any)[key];
        const targetValue = (target as any)[key];
  
        if (Array.isArray(sourceValue)) {
            if (sourceValue !== null) {
                (target as any)[key] = sourceValue;
            }
        } else if (typeof sourceValue === 'object' && sourceValue !== null) {
            if (typeof targetValue !== 'object' || targetValue === null) {
                (target as any)[key] = {};
            }
            mergeObjects(sourceValue, (target as any)[key]);
        } else if (sourceValue !== null) {
            (target as any)[key] = sourceValue;
        }
    });
  }