/** React-free ref cell — mirrors MutableRefObject without importing React in registrars. */
export type RefBox<T> = {
  current: T;
};