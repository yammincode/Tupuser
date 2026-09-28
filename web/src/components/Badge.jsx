export default function Badge({ tone = 'muted', children }) {
  return <span className={'badge ' + tone}>{children}</span>
}
