import antfu from '@antfu/eslint-config'

export default antfu({
  rules: {
    'style/semi': ['error', 'always'],
    "style/indent": [
      "error",
      2,
      {
        "ignoredNodes": [
          "FunctionExpression > .params[decorators.length > 0]",
          "FunctionExpression > .params > :matches(Decorator, :not(:first-child))",
          "ClassBody.body > PropertyDefinition[decorators.length > 0] > .key"
        ]
      }
    ],
    "space-before-function-paren": [
      "error",
      {
        "anonymous": "always",
        "named": "never",
        "asyncArrow": "always"
      }
    ],
    "style/brace-style": [
      "error",
      "1tbs",
      {
        "allowSingleLine": true
      }
    ]
  }
})
