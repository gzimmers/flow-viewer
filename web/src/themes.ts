// Monaco themes matching the app palette.
import { monaco } from './monaco-setup'

monaco.editor.defineTheme('flow-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '6a737d', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'c586c0' },
    { token: 'string', foreground: 'ce9178' },
    { token: 'number', foreground: 'b5cea8' },
    { token: 'type', foreground: '4ec9b0' },
    { token: 'identifier', foreground: 'd4d4d4' },
  ],
  colors: {
    'editor.background': '#1a1b1e',
    'editor.foreground': '#d4d6da',
    'editor.lineHighlightBackground': '#22232700',
    'editor.lineHighlightBorder': '#2c2e33',
    'editorLineNumber.foreground': '#4d5158',
    'editorLineNumber.activeForeground': '#9aa0a8',
    'editorCursor.foreground': '#5e9eff',
    'editor.selectionBackground': '#264f78',
    'editorWhitespace.foreground': '#2c2e33',
    'editorIndentGuide.background1': '#26272b',
    'editorIndentGuide.activeBackground1': '#3a3d42',
    'editorGutter.background': '#1a1b1e',
    'editorWidget.background': '#202124',
    'editorWidget.border': '#2d2f33',
    'editorHoverWidget.background': '#202124',
    'editorHoverWidget.border': '#2d2f33',
    'minimap.background': '#1a1b1e',
    'scrollbarSlider.background': '#3a3d4266',
    'scrollbarSlider.hoverBackground': '#3a3d42aa',
  },
})

monaco.editor.defineTheme('flow-light', {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '6a737d', fontStyle: 'italic' },
  ],
  colors: {
    'editor.background': '#f7f8fa',
    'editor.foreground': '#24272c',
    'editor.lineHighlightBackground': '#eef0f3',
    'editorLineNumber.foreground': '#9aa0a8',
    'editorLineNumber.activeForeground': '#4d5158',
    'editorCursor.foreground': '#2563eb',
    'editor.selectionBackground': '#c9dcff',
    'editorIndentGuide.background1': '#e4e7ec',
    'editorIndentGuide.activeBackground1': '#c4c9d1',
    'editorGutter.background': '#f7f8fa',
    'editorWidget.background': '#ffffff',
    'editorWidget.border': '#dde0e5',
    'editorHoverWidget.background': '#ffffff',
    'editorHoverWidget.border': '#dde0e5',
    'minimap.background': '#f7f8fa',
    'scrollbarSlider.background': '#c4c9d166',
    'scrollbarSlider.hoverBackground': '#c4c9d1aa',
  },
})
