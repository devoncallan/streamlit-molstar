import { Mat3 } from "@dp-launching/molstar/lib/mol-math/linear-algebra/3d/mat3"

export function rotateX(deg) {
  const rad = (deg * Math.PI) / 180
  return Mat3.create(
    1,
    0,
    0,
    0,
    Math.cos(rad),
    -Math.sin(rad),
    0,
    Math.sin(rad),
    Math.cos(rad)
  )
}

export function rotateY(deg) {
  const rad = (deg * Math.PI) / 180
  return Mat3.create(
    Math.cos(rad),
    0,
    Math.sin(rad),
    0,
    1,
    0,
    -Math.sin(rad),
    0,
    Math.cos(rad)
  )
}

export function rotateZ(deg) {
  const rad = (deg * Math.PI) / 180
  return Mat3.create(
    Math.cos(rad),
    -Math.sin(rad),
    0,
    Math.sin(rad),
    Math.cos(rad),
    0,
    0,
    0,
    1
  )
}

export function rotateBy(rotations) {
  // Start with an identity matrix if no rotations are provided
  if (rotations.length === 0) {
    return Mat3.identity()
  }

  // Initialize the result with the first matrix in the list
  let resultMatrix = Mat3.identity()

  // Sequentially multiply the matrices
  for (let i = 0; i < rotations.length; i++) {
    resultMatrix = Mat3.mul(resultMatrix, resultMatrix, rotations[i])
  }

  return resultMatrix
}
