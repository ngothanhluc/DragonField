using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.SceneManagement;

public class AgentAnimations : MonoBehaviour
{
    private Animator animator;
    [SerializeField]
    private SpriteRenderer sprite;

    private void Awake()
    {
        animator = sprite.GetComponent<Animator>();
    }

    public void RotateToPointer(Vector2 lookDirection)
    {
        Vector3 scale = transform.localScale;
        if (lookDirection.x > 0)
        {
            scale.x = 1;
        }
        else if (lookDirection.x < 0)
        {
            scale.x = -1;
        }
        transform.localScale = scale;
    }

    public void PlayAnimation(Vector2 movementInput)
    {
        animator.SetBool("isMoving", movementInput.magnitude > 0);
    }

    public void PlayDeathAnimation()
    {
        animator.SetTrigger("death");
    }
    public void RestartGame()
    {
        SceneManager.LoadScene(1, LoadSceneMode.Single);
    }
}