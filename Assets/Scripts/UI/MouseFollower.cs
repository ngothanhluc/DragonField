using System.Collections.Generic;
using UnityEngine;
using UnityEngine.InputSystem;
using Inventory.UI;
public class MouseFollower : MonoBehaviour
{
    [SerializeField]
    private Canvas canvas;

    [SerializeField]
    private UIInventoryItem item;

    [SerializeField]
    private InputAction mousePositionAction;

    private Vector2 mousePosition;

    public void Awake()
    {
        canvas = transform.root.GetComponent<Canvas>();
        item = GetComponentInChildren<UIInventoryItem>();
        mousePositionAction.Enable();
    }

    public void OnEnable()
    {
        mousePositionAction.Enable();
    }

    public void OnDisable()
    {
        mousePositionAction.Disable();
    }

    public void SetData(Sprite sprite, int quantity)
    {
        item.SetData(sprite, quantity);
    }

    void Update()
    {
        if (mousePositionAction.triggered)
        {
            mousePosition = mousePositionAction.ReadValue<Vector2>();
            Vector2 localPosition;
            RectTransformUtility.ScreenPointToLocalPointInRectangle(
                (RectTransform)canvas.transform,
                mousePosition,
                canvas.worldCamera,
                out localPosition
            );
            transform.position = canvas.transform.TransformPoint(localPosition);
        }
    }

    public void Toggle(bool val)
    {
        gameObject.SetActive(val);
    }
}
